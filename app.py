# app.py
from flask import Flask, render_template, request, jsonify
import json
import paramiko
import threading
import time
import socket

app = Flask(__name__)

# Variable global para almacenar la configuración
CONFIG = None


# ──────────────────────────────────────────────────────────────
#  Adaptador VyOS 1.4 → formato interno (igual que 1.3)
# ──────────────────────────────────────────────────────────────
def adapt_14(raw14):
    """
    Convierte el JSON de VyOS 1.4 al mismo esquema que usa la UI (1.3).
    Solo adaptamos lo que hoy consume la interfaz: firewall y nat.
    """
    cfg = {
        # En 1.3 teníamos firewall.name y firewall.group; recreamos ambos
        "firewall": {
            "name":  {},                                       # se rellena abajo
            "group": raw14.get("firewall", {}).get("group", {})# ← copia grupos
        },
        # NAT mantiene la misma forma entre 1.3 y 1.4
        "nat":  raw14.get("nat", {}),

        # Copiamos el resto tal cual (por si la UI los usa)
        "system":    raw14.get("system",    {}),
        "service":   raw14.get("service",   {}),
        "protocols": raw14.get("protocols", {}),
        "policy":    raw14.get("policy",    {})
    }

    # —— trasladamos los rule-sets IPv4 (firewall.ipv4.name.*.rule) ——
    fw14 = raw14.get("firewall", {}).get("ipv4", {})
    for rs_name, rs_data in fw14.get("name", {}).items():
        cfg["firewall"]["name"][rs_name] = {
            "default-action": rs_data.get("default-action"),
            "rule": rs_data.get("rule", {})
        }

    # (Si quisieras IPv6, repite lo mismo para firewall.ipv6.name.*)
    return cfg


def load_config(raw):
    """Detecta versión y devuelve el formato interno unificado."""
    if "firewall" in raw and "ipv4" in raw["firewall"]:
        # Detectamos que es 1.4 (tiene firewall.ipv4)
        return adapt_14(raw)
    # Caso 1.3 u “antiguo”: ya está en formato interno
    return raw
# ──────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload():
    global CONFIG
    f = request.files.get('file')
    if not f:
        return jsonify({'status':'error','message':'No file uploaded'}), 400
    try:
        CONFIG = load_config(json.load(f))
        return jsonify({'status':'ok', 'data': CONFIG})
    except Exception as e:
        return jsonify({'status':'error','message': str(e)}), 400

@app.route('/api/firewall/rulesets')
def firewall_rulesets():
    if not CONFIG:
        return jsonify([])
    return jsonify(list(CONFIG['firewall']['name'].keys()))

@app.route('/api/firewall/ruleset/<rs>')
def firewall_ruleset(rs):
    if not CONFIG:
        return jsonify({})
    return jsonify(CONFIG['firewall']['name'].get(rs, {}))

@app.route('/api/firewall/group/<gtype>/<gname>')
def firewall_group(gtype, gname):
    if not CONFIG:
        return jsonify({})
    return jsonify(CONFIG['firewall']['group'].get(f"{gtype}-group", {}).get(gname, {}))

@app.route('/api/<section>')
def get_section(section):
    if not CONFIG:
        return jsonify({})
    return jsonify(CONFIG.get(section.lower(), {}))


@app.route('/fetch-config', methods=['POST'])
def fetch_config():
    data = request.get_json() or {}
    host     = data.get('host')
    port     = data.get('port', 22)
    user     = data.get('user', 'vyos')
    password = data.get('password')  # None si no se envía

    if not host:
        return jsonify(error='Host es obligatorio'), 400

    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        # Resolve IP manually to avoid paramiko DNS issues
        try:
            ip_address = socket.gethostbyname(host.strip())
            print(f"DEBUG: Resolved '{host}' to '{ip_address}'")
        except Exception as e:
            return jsonify(error=f"DNS resolution failed: {str(e)}"), 400

        # Intentar auth con clave si no hay password
        if password:
            ssh.connect(hostname=ip_address, port=port, username=user,
                        password=password, timeout=5)
        else:
            ssh.connect(hostname=ip_address, port=port, username=user, timeout=5)

        # Abrimos canal interactivo
        chan = ssh.invoke_shell()
        time.sleep(0.5)
        chan.recv(9999)  # limpiamos el banner

        # Entrar en modo config y lanzar show | json
        chan.send('configure\n')
        time.sleep(0.2)
        chan.send('run show configuration | json\n')
        time.sleep(0.2)
        chan.send('exit\n')
        time.sleep(0.2)

        output = b''
  #      while chan.recv_ready():
  #          output += chan.recv(4096)
        # Leemos todo el output hasta 30 s máximo:
        # Leemos hasta 30 s máximo, pero salimos antes si no llega nada en 2 s
        start_time = time.time()
        last_recv  = start_time
        while time.time() - start_time < 30:
            if chan.recv_ready():
                chunk = chan.recv(4096)
                output += chunk
                last_recv = time.time()
            else:
                time.sleep(0.1)
                # si han pasado 2 s sin recibir nada, damos por terminada la salida
                if time.time() - last_recv > 2:
                    break

        ssh.close()

        text = output.decode('utf-8', errors='ignore')
        # Extraer el JSON puro: desde el primer '{' hasta el último '}'
        start = text.find('{')
        end   = text.rfind('}')
        if start < 0 or end < 0:
            raise ValueError('No se ha encontrado JSON en la salida SSH')

        json_text = text[start:end+1]
        cfg = json.loads(json_text)
        global CONFIG
        CONFIG = load_config(cfg)
        return jsonify({'status': 'ok', 'data': CONFIG})
    except paramiko.AuthenticationException:
        return jsonify(error='Autenticación SSH fallida'), 401
    except Exception as e:
        return jsonify(error=str(e)), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)

import socket
import paramiko
import sys

host = "es-glb-ins-ifw02-01"
port = 22
user = "vyos"

print(f"--- Diagnostics for {host} ---")

# 1. Test DNS Resolution via socket
print(f"[1] Testing DNS resolution for '{host}'...")
try:
    addr_info = socket.gethostbyname_ex(host)
    print(f"    SUCCESS: Resolved to {addr_info}")
except Exception as e:
    print(f"    FAILURE: socket.gethostbyname_ex failed: {e}")

# 2. Test Paramiko Connection
print(f"[2] Testing Paramiko connection to '{host}:{port}'...")
try:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print("    Connecting...")
    ssh.connect(hostname=host, port=port, username=user, timeout=5)
    print("    SUCCESS: SSH Connected!")
    ssh.close()
except Exception as e:
    print(f"    FAILURE: Paramiko connect failed: {e}")

# VyOS Config Viewer

A modern, web-based interface for visualizing, analyzing, and searching VyOS router configurations. This tool simplifies the management of complex firewall and NAT rulesets by providing a clean, interactive dashboard.

## 🚀 Features

### Core Functionality
- **Dual Config Support**: Seamlessly handles both VyOS 1.3 and 1.4 JSON configuration formats.
- **Config Loading**:
  - **Upload**: Drag & drop your `config.json` file.
  - **SSH Fetch**: Connect directly to a live VyOS router to fetch the running configuration.
- **Firewall Visualization**:
  - View rulesets in a structured table.
  - **Group Expansion**: Toggle between raw group names (e.g., `LAN_NETS`) and their resolved values (IPs/CIDRs) with a single click.
  - **Traffic Search**: Simulate traffic flows (Source IP/Port -> Dest IP/Port) to find which rule matches first.
- **NAT Visualization**: Dedicated tables for Source and Destination NAT rules.

### 🎨 Modern UI & UX
- **Theming**: Choose your style with **Light**, **Dark**, and **Retro** (Cyberpunk/Terminal) themes.
- **Dashboard Charts**: Visual overview of your configuration:
  - **Firewall Stats**: Bar chart showing rule counts per ruleset.
  - **NAT Stats**: Doughnut chart comparing Source vs. Destination NAT rules.
- **Advanced Filtering**:
  - **Inline Filters**: Filter any column (Rule ID, IP, Port, Description) directly from the table header.
  - **Smart IP Filtering**: Supports CIDR notation (e.g., `192.168.1.0/24`) and ranges.
- **Responsive Design**: Optimized for various screen sizes with fluid layouts and sticky headers.

## 🛠️ Installation

### Prerequisites
- Python 3.x
- pip

### Setup
1.  Clone the repository:
    ```bash
    git clone https://github.com/darconada/vyos-config-viewer.git
    cd vyos-config-viewer
    ```

2.  Install dependencies:
    ```bash
    pip install -r requirements.txt
    ```

3.  Run the application:
    ```bash
    python app.py
    ```

4.  Open your browser and navigate to:
    ```
    http://localhost:5000
    ```

## 📖 Usage

### Loading a Configuration
You have two options to load data:
1.  **Upload JSON**: Click "Upload JSON" and select a configuration file exported from VyOS (`show configuration | json`).
2.  **Connect via SSH**: Click "Connect", enter your router's Hostname/IP, Port, User, and Password. The app will fetch the config automatically.

### Analyzing Firewall Rules
1.  Select "Firewall" from the main menu.
2.  Click on a Ruleset name to view its rules.
3.  Use the **"Mostrar valores" / "Mostrar grupos"** button to toggle group resolution.
4.  Click **"Buscar tráfico"** to test which rule would catch a specific packet.

### Analyzing NAT
1.  Select "NAT" from the main menu.
2.  View "Destination NAT" and "Source NAT" tables side-by-side (or stacked on smaller screens).
3.  Use the inline filters to find specific translations.

## 🏗️ Architecture

### Backend (Flask)
- **`app.py`**: Handles routing, file uploads, and SSH connections.
- **Adapter Pattern**: Automatically detects VyOS 1.4 configs and transforms them to the internal 1.3-compatible format for consistent rendering.
- **SSH Logic**: Uses `paramiko` for connections and `socket` for robust hostname resolution.

### Frontend (Vanilla JS + CSS)
- **`static/app.js`**: Handles all UI logic, rendering, filtering, and API calls. No heavy frontend frameworks—just clean, efficient JavaScript.
- **`static/style.css`**: Custom CSS system with variables for theming and responsive grid layouts.
- **Chart.js**: Powers the interactive dashboard charts.

## 🤝 Contributing
Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License
This project is open-source. Feel free to use and modify it for your needs.

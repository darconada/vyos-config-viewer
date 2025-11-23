# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VyOS Config Viewer is a Flask-based web application that provides a visual interface for viewing and analyzing VyOS router configurations. It supports both VyOS 1.3 and 1.4 JSON configuration formats.

### Core Capabilities
- Upload VyOS config JSON files or fetch directly from VyOS router via SSH
- View and filter firewall rulesets with group expansion
- View and filter NAT rules (destination and source)
- Search for traffic flows through firewall rules
- Resolve firewall groups (address-group, network-group, port-group) inline or via modal

## Development Commands

### Running the Application
```bash
python app.py
# Server runs on http://0.0.0.0:5000
```

### Install Dependencies
```bash
pip install -r requirements.txt
```

## Architecture

### Version Compatibility Layer (app.py:17-57)
The application handles two VyOS config formats through an adapter pattern:

- **VyOS 1.3**: Config JSON is used as-is (firewall.name structure)
- **VyOS 1.4**: Detected by presence of `firewall.ipv4` structure. The `adapt_14()` function transforms it to match 1.3 format
  - Translates `firewall.ipv4.name.*.rule` → `firewall.name.*.rule`
  - Copies `firewall.group` and `nat` sections unchanged
  - Detection happens in `load_config()` at app.py:50-56

All downstream code (UI and API endpoints) works with the unified internal format.

### Backend Structure (app.py)
- **Global state**: `CONFIG` variable stores the parsed configuration
- **Upload flow**: `/upload` endpoint → `load_config()` → version detection → adapter
- **SSH fetch flow**: `/fetch-config` endpoint → SSH connection → `show configuration | json` → `load_config()`
  - Uses paramiko for SSH with password or key-based auth
  - Reads output until 2s idle timeout (max 30s total)
  - Extracts JSON between first `{` and last `}`

### API Endpoints
- `/api/firewall/rulesets` - Lists all firewall rule-set names
- `/api/firewall/ruleset/<rs>` - Returns rules for specific rule-set
- `/api/firewall/group/<gtype>/<gname>` - Returns group contents (address/network/port)
- `/api/<section>` - Returns any config section (system, service, protocols, policy)
- `/api/NAT` - Returns both destination and source NAT rules

### Frontend Architecture (static/app.js)

#### State Management
- `CONFIG` (backend): Global parsed config
- `currentRulesetName`, `currentRulesetData`: Active firewall rule-set
- `groupCache`: Preloaded firewall groups for current rule-set (format: `{type}-{name}`)
- `natData`: Full NAT config for re-rendering after filter changes
- `showResolved`: Toggle between group names and resolved values

#### Firewall Rule Rendering Flow
1. `viewRuleset()` (app.js:209-266): Fetch rule-set → preload all referenced groups → reset filters → render
2. Group preloading scans all rules for `address-group`, `network-group`, `port-group` references (including negated `!group`)
3. `renderRuleset()` (app.js:268-356): Build table with filters → apply IP/port/text filters → render rows
4. Filters apply before rendering: IP filters use CIDR matching, port filters support ranges/lists, text filters use substring match

#### NAT Rule Rendering
- `renderNat()` renders two tables: Destination NAT and Source NAT
- Each table has independent text and IP/CIDR filters stored in `natTextFilters` and `natIpFilters` objects
- Filters are per-table and per-column (e.g., `natIpFilters['Destination NAT']['destination.address']`)

#### IP/Port Matching Logic
- **IP matching** (`matchIP`, app.js:511-551): Supports CIDR, ranges (a-b), comma-separated lists, negated groups (`!groupname`)
- **Port matching** (`matchPort`, app.js:613-637): Supports single ports, ranges (2000-3000), comma lists (80,443,8080), port-groups
- **Protocol matching** (`matchProtocol`, app.js:640-652): Handles `tcp_udp` as union type

#### Traffic Search Feature (app.js:443-500)
Modal-based search for firewall rules matching specific traffic:
- Input: source IP/port, destination IP/port, protocol
- Iterates rules in order (sorted by ID) and returns first match
- Uses same `matchRule()` logic as filter system
- Highlights matching row on "Go to" button click

## Key Implementation Details

### Group Negation Support
- Firewall groups can be negated with `!` prefix (e.g., `!TRUSTED_NETS`)
- Detection: `name.startsWith('!')`
- Stripped for cache lookup but preserved in display
- Match logic inverted: `neg ? !hit : hit`

### Filter System Architecture
Dual-mode filtering based on column type:
- **Text filters** (`filters` object): Substring matching for description, protocol, action
- **IP filters** (`ipFilters` object): CIDR/range matching for source/destination
- **Port filters**: Supports range specs in text filter (e.g., "80,443" or "1000-2000")

Filter check happens in `renderRuleset()` before row rendering (app.js:307-336).

### SSH Connection Details
- Default user: `vyos`, default port: 22
- Supports password or SSH key authentication (key if no password provided)
- Uses interactive shell (`invoke_shell()`) to enter config mode
- Command sequence: `configure` → `run show configuration | json` → `exit`
- Output extraction: finds JSON between first `{` and last `}` to handle shell prompts

## File Structure
```
vyos-config-viewer/
├── app.py              # Flask backend with API endpoints and version adapter
├── requirements.txt    # Flask>=2.2.5, paramiko>=2.11.0
├── templates/
│   └── index.html     # Minimal HTML shell
└── static/
    ├── app.js         # All UI logic, rendering, filtering
    └── modal.css      # Modal styles for group/search dialogs
```

## Common Development Patterns

### Adding a New Firewall Column
1. Add column definition to `cols` array in `renderRuleset()` (app.js:279)
2. Extract value in row-building loop (app.js:311-320)
3. Add cell rendering in HTML template (app.js:339-348)
4. If filterable, add filter button in header (app.js:290-300)

### Adding a New Config Section
1. Add section name to `sections` array (app.js:16)
2. If special rendering needed, add case to `loadSection()` (app.js:47-54)
3. For custom UI, create render function like `renderNat()`

### Supporting VyOS 1.4 New Features
1. Update `adapt_14()` function to map new 1.4 structure to internal format
2. If no 1.3 equivalent exists, extend internal format and update UI code
3. Test with both version config files to ensure backward compatibility

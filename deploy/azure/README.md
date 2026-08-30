# WaCalls on Azure

The production relay runs as an unprivileged `systemd` service behind Caddy. Its SQLite/WhatsApp session lives in `/var/lib/volta-wacalls`, while secrets live only in the root-owned `/etc/volta-wacalls.env` file.

Required inbound rules:

- TCP 443 for the authenticated WaCalls API;
- TCP 80 for Caddy certificate issuance and renewal;
- UDP 50000–50100 for the browser takeover WebRTC media path;
- TCP 22 restricted to the current operator IP.

`WACALLS_WEBRTC_PUBLIC_IP` must match the Azure static public IP. Pion advertises that address in ICE while constraining media to the NSG UDP range.

Deployments must preserve `/var/lib/volta-wacalls/wacalls.db`, because it contains the paired WhatsApp device session. Never commit the database, environment file, SSH key, API token, or relay secret.

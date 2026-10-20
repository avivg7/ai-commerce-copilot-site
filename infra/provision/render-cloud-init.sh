#!/usr/bin/env bash
# Render cloud-init.template.yaml with the operator's SSH PUBLIC key.
# Usage: infra/provision/render-cloud-init.sh ~/.ssh/aicc_cp_stage.pub  > cloud-init.rendered.yaml
# Refuses anything that is not a single-line ed25519 PUBLIC key, and refuses the existing production API key by name.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pub="${1:-}"
[ -n "$pub" ] || { echo "usage: $0 <path-to-.pub>" >&2; exit 2; }
[ -f "$pub" ] || { echo "no such file: $pub" >&2; exit 2; }
case "$(basename "$pub")" in
  aicc_digitalocean_prod*) echo "REFUSED: that is the production API Droplet key. Create a dedicated key (see README-droplet-creation.md)." >&2; exit 3;;
esac
if grep -q "PRIVATE KEY" "$pub"; then echo "REFUSED: that file contains a PRIVATE key. Pass the .pub file." >&2; exit 3; fi
lines="$(grep -c . "$pub" || true)"
[ "$lines" = "1" ] || { echo "REFUSED: the public key file must contain exactly one line (found $lines)." >&2; exit 3; }
key="$(sed -e 's/[[:space:]]*$//' "$pub")"
case "$key" in
  ssh-ed25519\ AAAA*) ;;
  *) echo "REFUSED: expected an ssh-ed25519 public key (starts with 'ssh-ed25519 AAAA')." >&2; exit 3;;
esac
python3 - "$here/cloud-init.template.yaml" "$key" <<'PY'
import sys
tpl, key = sys.argv[1], sys.argv[2]
s = open(tpl).read()
assert "__OPERATOR_SSH_PUBLIC_KEY__" in s
sys.stdout.write(s.replace("__OPERATOR_SSH_PUBLIC_KEY__", key))
PY

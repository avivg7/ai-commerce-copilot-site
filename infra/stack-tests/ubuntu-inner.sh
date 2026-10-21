#!/usr/bin/env bash
# Runs INSIDE the Ubuntu 24.04 container created by test_ubuntu.sh (as root; /bundle is the read-only repo bundle, /art the built CP release, /opt/wp-cli.phar the pinned phar).
# It exercises the real thing the Mac cannot: Ubuntu's PHP 8.3 + php-fpm, MySQL 8.0, systemd 255 (systemd-analyze only: no PID 1), fail2ban 1.0.2, OpenSSH 9.6, GNU coreutils,
# bash 5.2, auth_socket root access, setfacl, useradd. NOT exercised (needs the real host): systemd as PID 1 (ordering, sandboxing, timers), UFW, Caddy, Let's Encrypt, DigitalOcean.
set -uo pipefail
export PATH=/usr/local/bin:$PATH
T_SUITE="ubuntu-24.04-container"; . /bundle/infra/stack-tests/lib/t.sh
IS="bash /bundle/infra/provision/install-stack.sh"
RELOAD='kill -USR2 $(cat /run/php/php8.3-fpm.pid)'
R=/srv/aicc/cp/releases
fcgi() { # fcgi <script-filename> [query]   -> raw FastCGI response
  REQUEST_METHOD=GET SCRIPT_FILENAME="$1" SCRIPT_NAME="${3:-$1}" DOCUMENT_ROOT="$(dirname "$1")" QUERY_STRING="${2:-}" REQUEST_URI="${3:-$1}?${2:-}" HTTPS=on HTTP_HOST=stage.copilt.org SERVER_NAME=stage.copilt.org \
  REMOTE_ADDR=203.0.113.9 SERVER_PROTOCOL=HTTP/1.1 GATEWAY_INTERFACE=CGI/1.1 cgi-fcgi -bind -connect /run/php/aicc-cp.sock 2>&1
}
hdr() { fcgi "$1/index.php" "rest_route=/" /index.php | sed -n 's/^X-Aicc-Release: *//p' | head -1 | tr -d '\r'; }

echo "== container facts"
t_eq "Ubuntu 24.04" "$(. /etc/os-release; echo "$VERSION_ID")" "24.04"
t_contains "PHP 8.3" "$(php-fpm8.3 -v | head -1)" "PHP 8.3."
t_contains "MySQL 8.0" "$(mysqld --version)" "Ver 8.0."
t_contains "fail2ban 1.0.x" "$(fail2ban-client --version | head -1)" "1.0."

echo "== install-stack.sh on real Ubuntu (systemctl/sysctl stubbed: there is no PID 1)"
id aicc >/dev/null 2>&1 || useradd -m -s /bin/bash aicc
printf '#!/bin/sh\necho "systemctl $*" >> /var/log/stub-systemctl.log\nexit 0\n' > /usr/local/bin/systemctl; printf '#!/bin/sh\nexit 0\n' > /usr/local/bin/sysctl; chmod +x /usr/local/bin/systemctl /usr/local/bin/sysctl
printf '#!/bin/sh\necho v2.11.7 h1:dummy-binary-only-so-that-systemd-analyze-finds-an-executable\n' > /usr/local/bin/caddy; chmod +x /usr/local/bin/caddy
cp /opt/wp-cli.phar /usr/local/bin/wp; chmod 0755 /usr/local/bin/wp
printf 'AICC_ENV=staging\nAICC_HOSTNAME=stage.copilt.org\n' > /etc/aicc-stage-identity
install -d -o mysql -g mysql -m 0755 /run/mysqld; install -d -o mysql -g adm -m 0750 /var/log/mysql
STEPS=identity,users-dirs,wpcli,php,mysql,sysctl,scripts,systemd,logrotate,fail2ban
t_ok "steps $STEPS succeed" bash -c "$IS --only $STEPS"
t_ok "edge-env renders (stage id read from the identity file)" bash -c "$IS --only edge-env --acme-email ops@example.org"
SECOND="$($IS --only $STEPS 2>&1 | grep -v '^====' | grep -E 'installed:|created |chmod |chown |symlink /|run: (setfacl|groupadd|useradd)' || true)"
[ -z "$SECOND" ] || printf '   second-run changes:\n%s\n' "$SECOND"
t_eq "second run changes nothing on a real system" "$(printf '%s' "$SECOND" | grep -c . || true)" "0"
t_ok "systemd-analyze verify (systemd 255) accepts every AICC unit" systemd-analyze verify /etc/systemd/system/aicc-edge.service /etc/systemd/system/aicc-wp-cron.service /etc/systemd/system/aicc-backup.service /etc/systemd/system/aicc-cert-expiry.service /etc/systemd/system/aicc-wp-cron.timer /etc/systemd/system/aicc-backup.timer /etc/systemd/system/aicc-cert-expiry.timer
t_ok "systemd-analyze verify accepts the failure-hook template (instantiated)" bash -c "cp /etc/systemd/system/aicc-notify-failure@.service '/etc/systemd/system/aicc-notify-failure@aicc-backup.service.service' && systemd-analyze verify '/etc/systemd/system/aicc-notify-failure@aicc-backup.service.service'; rc=\$?; rm -f '/etc/systemd/system/aicc-notify-failure@aicc-backup.service.service'; exit \$rc"
t_eq "uploads directory: setgid, 2750, group aicc-edge, owner aicc-cp (the ACL mask must not widen or narrow it)" "$(stat -c '%a %U:%G' /srv/aicc/shared/uploads)" "2750 aicc-cp:aicc-edge"
t_eq "PHP (aicc-cp) can still write to uploads after the ACLs" "$(sudo -u aicc-cp bash -c 'touch /srv/aicc/shared/uploads/.w && echo yes; rm -f /srv/aicc/shared/uploads/.w')" "yes"
t_eq "files PHP creates there are readable by the edge user (default ACL)" "$(sudo -u aicc-cp bash -c 'umask 077; touch /srv/aicc/shared/uploads/.r'; sudo -u aicc-edge bash -c 'cat /srv/aicc/shared/uploads/.r >/dev/null && echo yes'; rm -f /srv/aicc/shared/uploads/.r)" "yes"
t_eq "the edge user cannot WRITE to uploads" "$(sudo -u aicc-edge bash -c 'touch /srv/aicc/shared/uploads/.x 2>/dev/null && echo WROTE || echo no')" "no"
t_contains "uploads default ACL lets Caddy (aicc-edge) read new files" "$(getfacl -p /srv/aicc/shared/uploads)" "default:group:aicc-edge:r-x"
t_eq "secrets dir 0700 root" "$(stat -c '%a %U' /etc/aicc/secrets)" "700 root"
t_eq "backups dir 0751 root" "$(stat -c '%a %U' /srv/aicc/backups)" "751 root"
t_eq "release trees dir owned by the deploy user aicc" "$(stat -c '%U' /srv/aicc/cp/releases)" "aicc"
t_ok "logrotate accepts the AICC rules" logrotate --debug /etc/logrotate.conf
t_ok "fail2ban accepts the AICC jails (fail2ban-client -t)" fail2ban-client -t
t_eq "the default www pool is moved aside" "$(ls /etc/php/8.3/fpm/pool.d | tr '\n' ' ')" "aicc.conf www.conf.aicc-disabled "

echo "== MySQL 8.0 with the AICC drop-in (socket only)"
t_ok "mysqld --validate-config" mysqld --user=mysql --validate-config
(nohup mysqld --user=mysql >/tmp/mysqld.out 2>&1 &)
for _ in $(seq 1 60); do [ -S /run/mysqld/mysqld.sock ] && break; sleep 1; done
t_eq "effective: skip_networking=1 performance_schema=0 pool=192M chunk=64M max_connections=30 log_bin=0 redo=128M" "$(mysql -N -e 'SELECT @@skip_networking, @@performance_schema, @@innodb_buffer_pool_size, @@innodb_buffer_pool_chunk_size, @@max_connections, @@log_bin, @@innodb_redo_log_capacity' | tr '\t' ' ')" "1 0 201326592 67108864 30 0 134217728"
t_eq "effective: port 0 (no TCP listener at all)" "$(mysql -N -e 'SELECT @@port')" "0"
t_eq "effective: slow log on at 2 s, general log off, O_DIRECT" "$(mysql -N -e 'SELECT @@slow_query_log, @@long_query_time, @@general_log, @@innodb_flush_method' | tr '\t' ' ')" "1 2.000000 0 O_DIRECT"
t_ok "create-staging-db.sh works over auth_socket as root" bash /bundle/infra/provision/create-staging-db.sh
t_eq "secret files are 0600 root" "$(stat -c '%a %U' /etc/aicc/secrets/db-cp.pass /etc/aicc/backup.cnf | tr '\n' ' ')" "600 root 600 root "
t_ok "render-wp-config.sh works (php -l included)" bash /bundle/infra/provision/render-wp-config.sh
t_eq "wp-config.php is 0640 root:aicc-cp" "$(stat -c '%a %U:%G' /srv/aicc/shared/wp-config.php)" "640 root:aicc-cp"
t_fail "the app user cannot read the other schemas" bash -c "mysql --defaults-extra-file=<(printf '[client]\nuser=aicc_cp\npassword=%s\nsocket=/run/mysqld/mysqld.sock\n' \"\$(cat /etc/aicc/secrets/db-cp.pass)\") -e 'SELECT * FROM mysql.user'"

echo "== PHP-FPM pool as applied by real php-fpm 8.3 (user aicc-cp, socket /run/php/aicc-cp.sock)"
install -d -m 0755 /run/php
t_ok "php-fpm8.3 --test" php-fpm8.3 --test
(nohup php-fpm8.3 --nodaemonize --fpm-config /etc/php/8.3/fpm/php-fpm.conf >/tmp/fpm.out 2>&1 &)
for _ in $(seq 1 20); do [ -S /run/php/aicc-cp.sock ] && break; sleep 0.5; done
t_eq "socket is srw-rw---- aicc-cp:aicc-edge" "$(stat -c '%A %U:%G' /run/php/aicc-cp.sock)" "srw-rw---- aicc-cp:aicc-edge"
t_contains "/fpm-ping answers pong" "$(REQUEST_METHOD=GET SCRIPT_FILENAME=/fpm-ping SCRIPT_NAME=/fpm-ping cgi-fcgi -bind -connect /run/php/aicc-cp.sock)" "pong"
STATUS="$(REQUEST_METHOD=GET SCRIPT_FILENAME=/fpm-status SCRIPT_NAME=/fpm-status QUERY_STRING=json cgi-fcgi -bind -connect /run/php/aicc-cp.sock | tail -1)"
t_eq "/fpm-status reports pool 'aicc', dynamic" "$(echo "$STATUS" | jq -r '.pool + " " + ."process manager"')" "aicc dynamic"
t_eq "unrelated user (nobody) cannot connect to the socket" "$(sudo -u nobody bash -c 'REQUEST_METHOD=GET SCRIPT_FILENAME=/fpm-ping SCRIPT_NAME=/fpm-ping cgi-fcgi -bind -connect /run/php/aicc-cp.sock' 2>&1 | grep -c 'Could not connect')" "1"
t_contains "the edge user (aicc-edge) can connect" "$(sudo -u aicc-edge bash -c 'REQUEST_METHOD=GET SCRIPT_FILENAME=/fpm-ping SCRIPT_NAME=/fpm-ping cgi-fcgi -bind -connect /run/php/aicc-cp.sock' 2>&1)" "pong"
mkdir -p /tmp/probe; cat > /tmp/probe/p.php <<'PHP'
<?php header("Content-Type: application/json"); $s = opcache_get_status(false);
echo json_encode(["memory_limit"=>ini_get("memory_limit"),"validate"=>ini_get("opcache.validate_timestamps"),"opcache_mem"=>ini_get("opcache.memory_consumption"),"upload"=>ini_get("upload_max_filesize"),"post"=>ini_get("post_max_size"),"expose"=>ini_get("expose_php"),
 "disabled"=>ini_get("disable_functions"),"sendmail"=>ini_get("sendmail_path"),"maxexec"=>ini_get("max_execution_time"),"display_errors"=>ini_get("display_errors"),"cookie_secure"=>ini_get("session.cookie_secure"),"user"=>posix_getpwuid(posix_geteuid())["name"],
 "exec"=>function_exists("exec"),"jit"=>ini_get("opcache.jit"),"tmp"=>sys_get_temp_dir(),"max_input_vars"=>ini_get("max_input_vars"),"assert"=>ini_get("zend.assertions"),"opcache_on"=>$s!==false,
 "ext"=>array_values(array_intersect(["curl","mbstring","xml","zip","gd","intl","mysqli","imagick"],get_loaded_extensions()))]);
PHP
chmod -R a+rX /tmp/probe
P="$(fcgi /tmp/probe/p.php | tail -1)"
t_eq "runs as aicc-cp" "$(echo "$P" | jq -r .user)" "aicc-cp"
t_eq "memory_limit 192M" "$(echo "$P" | jq -r .memory_limit)" "192M"
t_eq "opcache on, validate_timestamps 0, 128 MiB" "$(echo "$P" | jq -r '[.opcache_on, .validate, .opcache_mem] | join(" ")')" "true 0 128"
t_eq "upload 64M / post 65M / max_input_vars 3000" "$(echo "$P" | jq -r '[.upload, .post, .max_input_vars] | join(" ")')" "64M 65M 3000"
t_eq "expose_php off, display_errors off, assertions off" "$(echo "$P" | jq -r '[.expose, .display_errors, .assert] | join(",")')" ",0,-1"
t_eq "exec() is disabled for web requests" "$(echo "$P" | jq -r .exec)" "false"
t_eq "mail goes to the file sink" "$(echo "$P" | jq -r .sendmail)" "/usr/local/sbin/aicc-mail-sink"
t_eq "max_execution_time 50 s (edge waits 60 s)" "$(echo "$P" | jq -r .maxexec)" "50"
t_eq "session cookies are Secure" "$(echo "$P" | jq -r .cookie_secure)" "1"
t_eq "required extensions present, imagick absent" "$(echo "$P" | jq -r '.ext | join(",")')" "curl,mbstring,xml,zip,gd,intl,mysqli"
t_eq "temp dir is the pool's private dir" "$(echo "$P" | jq -r .tmp)" "/var/lib/aicc-cp/tmp"
t_ok "the mail sink, run as aicc-cp, writes a 0600 file and sends nothing" bash -c "echo 'Subject: x' | sudo -u aicc-cp /usr/local/sbin/aicc-mail-sink && [ \"\$(stat -c %a /var/lib/aicc-cp/mail/*.eml | head -1)\" = 600 ]"

echo "== fail2ban 1.0.2 against REAL Caddy 2.11.7 log lines"
if [ -s /tmp/f2b-sample.log ]; then
  F="$(fail2ban-regex /tmp/f2b-sample.log /etc/fail2ban/filter.d/aicc-wp-login.conf 2>&1)"
  LINES="$(wc -l < /tmp/f2b-sample.log | tr -d ' ')"
  t_contains "datepattern \"ts\":{EPOCH} is accepted and used" "$F" "[$LINES] \"ts\":{EPOCH}"
  TRUTH="$(python3 - <<'PY'
import json, re
n = 0
for l in open("/tmp/f2b-sample.log"):
    j = json.loads(l); u = j["request"]["uri"].split("?")[0].lower()
    a = j["request"]["method"] == "POST" and re.match(r"^(?:/(?:he|es|ru))?/(?:my-account(?:/lost-password)?/?|wp-login\.php)$", u) is not None
    b = j["status"] in (403, 429) and any(t in u for t in ("/wp-login.php", "/xmlrpc.php", "/wp-admin/", "/wp-cron.php"))
    n += 1 if (a or b) else 0
print(n)
PY
)"
  t_contains "aicc-wp-login: fail2ban matches exactly the lines the JSON ground truth says ($TRUTH)" "$F" ", $TRUTH matched,"
  F2="$(fail2ban-regex /tmp/f2b-sample.log /etc/fail2ban/filter.d/caddy-4xx-flood.conf 2>&1)"
  TRUTH2="$(python3 -c '
import json
print(sum(1 for l in open("/tmp/f2b-sample.log") if 400 <= json.loads(l)["status"] <= 499 and json.loads(l)["status"] != 421 and not json.loads(l)["request"]["uri"].startswith(("/.well-known/acme-challenge/", "/favicon.ico"))))')"
  t_contains "caddy-4xx-flood: fail2ban matches exactly the 4xx lines ($TRUTH2)" "$F2" ", $TRUTH2 matched,"
else t_skip "fail2ban-regex on real log lines" "no /tmp/f2b-sample.log"; fi
# architecture review M-6: the OPTIONAL operator-owned override (absent by default) is accepted by the real fail2ban and changes ignoreip
printf '[aicc-wp-login]\nignoreip = 127.0.0.1/8 ::1 10.19.0.2\n' > /etc/fail2ban/jail.d/zz-aicc-local.local
t_ok "fail2ban 1.0.2 accepts the operator override jail.d/zz-aicc-local.local" fail2ban-client -t
t_contains "...and the effective ignoreip of aicc-wp-login includes the extra address" "$(fail2ban-client -d 2>/dev/null | grep -i aicc-wp-login | grep -i ignoreip)" "10.19.0.2"
rm -f /etc/fail2ban/jail.d/zz-aicc-local.local

echo "== stage 2 hardening against REAL OpenSSH 9.6"
mkdir -p /run/sshd /run/aicc; ssh-keygen -A >/dev/null 2>&1
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPubkeyAuthentication yes\nPermitRootLogin prohibit-password\nPermitEmptyPasswords no\nX11Forwarding no\nMaxAuthTries 3\nLoginGraceTime 30\nClientAliveInterval 300\nClientAliveCountMax 2\nAllowAgentForwarding no\n' > /etc/ssh/sshd_config.d/10-aicc-hardening.conf
mkdir -p /home/aicc/.ssh; ssh-keygen -q -t ed25519 -N "" -f /tmp/dummy_key -C aicc-test; cp /tmp/dummy_key.pub /home/aicc/.ssh/authorized_keys; chmod 600 /home/aicc/.ssh/authorized_keys; chown -R aicc:aicc /home/aicc/.ssh
t_contains "before: root login is key-only" "$(sshd -T -C user=root,host=localhost,addr=127.0.0.1 | grep '^permitrootlogin')" "without-password"
export AICC_TEST_HARNESS=1 AICC_MARKER_PATH=/run/aicc/stage2-verified AICC_SYSTEMCTL_BIN=/usr/local/bin/systemctl
t_ok "verify step writes the marker (real sshd -T checks)" env AICC_TEST_SSH_ANCESTOR=300:aicc bash /bundle/infra/provision/stage2-verify-second-session.sh
t_ok "harden-stage2 succeeds from the first session" env AICC_TEST_SSH_ANCESTOR=100:root bash /bundle/infra/provision/harden-stage2.sh
t_eq "after: root login refused by the effective config" "$(sshd -T -C user=root,host=localhost,addr=127.0.0.1 | grep '^permitrootlogin')" "permitrootlogin no"
t_eq "after: only aicc may log in" "$(sshd -T -C user=aicc,host=localhost,addr=127.0.0.1 | grep '^allowusers')" "allowusers aicc"
t_ok "after: sshd -t is happy" sshd -t
mv /etc/ssh/sshd_config.d/05-aicc-stage2.conf /etc/ssh/sshd_config.d/20-aicc-stage2.conf
t_contains "CONTROL: a drop-in sorted AFTER cloud-init's file would be ignored (first value wins), which is why the file is called 05-" "$(sshd -T -C user=root,host=localhost,addr=127.0.0.1 | grep '^permitrootlogin')" "without-password"
rm -f /etc/ssh/sshd_config.d/20-aicc-stage2.conf
t_ok "rollback command: remove + sshd -t" bash -c "sshd -t"
unset AICC_TEST_HARNESS AICC_MARKER_PATH AICC_SYSTEMCTL_BIN

echo "== two-session scripts over REAL sshd sessions (sshd -D on 127.0.0.1:2222, key auth; journalctl stubbed to read sshd's own log)"
command -v ss >/dev/null 2>&1 || { DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends iproute2 >/dev/null 2>&1; }
echo 'aicc ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/aicc; chmod 440 /etc/sudoers.d/aicc
usermod -p '*' aicc   # an unlocked account without a password: key login works, password login cannot
printf 'Port 2222\nListenAddress 127.0.0.1\nHostKey /etc/ssh/ssh_host_ed25519_key\nPubkeyAuthentication yes\nPasswordAuthentication no\nUsePAM no\nAllowUsers aicc\nPidFile /tmp/sshd-test.pid\nLogLevel INFO\n' > /tmp/sshd_test_config
(nohup /usr/sbin/sshd -D -e -f /tmp/sshd_test_config > /tmp/sshd.log 2>&1 &); sleep 1
printf '#!/bin/sh\ncat /tmp/sshd.log\n' > /usr/local/bin/journalctl; chmod +x /usr/local/bin/journalctl
rm -f /run/aicc/stage2-verified /etc/ssh/sshd_config.d/05-aicc-stage2.conf
SSHC=(ssh -p 2222 -i /tmp/dummy_key -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o IdentitiesOnly=yes aicc@127.0.0.1)
t_eq "the test sshd accepts the aicc key" "$("${SSHC[@]}" 'id -un' 2>/dev/null)" "aicc"
t_rc "verify step run as root WITHOUT sudo-from-aicc is refused" 1 bash /bundle/infra/provision/stage2-verify-second-session.sh
OUTV="$("${SSHC[@]}" 'sudo bash /bundle/infra/provision/stage2-verify-second-session.sh' 2>&1)"; rcv=$?
t_eq "verify step in a REAL ssh session as aicc passes (process-tree detection, ss peer, sshd log line 'Accepted publickey')" "$rcv" "0"
[ "$rcv" = 0 ] || echo "$OUTV" | tail -8
t_contains "...it found the sshd log line for this very connection" "$OUTV" "Accepted publickey for aicc"
t_contains "marker records a loopback peer, this boot, auth log checked" "$(cat /run/aicc/stage2-verified 2>/dev/null)" "AUTH_LOG_CHECKED=yes"
t_eq "marker is root:root 0600" "$(stat -c '%U:%G %a' /run/aicc/stage2-verified)" "root:root 600"
OUTH="$("${SSHC[@]}" 'sudo bash /bundle/infra/provision/harden-stage2.sh' 2>&1)"; rch=$?
t_eq "harden-stage2 from a DIFFERENT real session than the verifying one succeeds (non-harness path, real sshd -t/-T)" "$rch" "0"
[ "$rch" = 0 ] || echo "$OUTH" | tail -8
t_eq "...root login is refused by the effective config" "$(sshd -T -C user=root,host=localhost,addr=127.0.0.1 | grep '^permitrootlogin')" "permitrootlogin no"
t_eq "...and the existing sessions were not closed (the test sshd still serves aicc)" "$("${SSHC[@]}" 'id -un' 2>/dev/null)" "aicc"
rm -f /etc/ssh/sshd_config.d/05-aicc-stage2.conf
# the same session may not be used for both steps
"${SSHC[@]}" 'sudo bash /bundle/infra/provision/stage2-verify-second-session.sh >/dev/null 2>&1; sudo bash /bundle/infra/provision/harden-stage2.sh' > /tmp/same.out 2>&1
t_contains "verify + harden from the SAME session is refused" "$(cat /tmp/same.out)" "SAME session"
t_fail "...and nothing was written" test -e /etc/ssh/sshd_config.d/05-aicc-stage2.conf
pkill -f 'sshd -D -e -f /tmp/sshd_test_config' 2>/dev/null; rm -f /usr/local/bin/journalctl /run/aicc/stage2-verified

echo "== release pipeline on real PHP 8.3 + MySQL 8.0: first install, swap, health gate, rollback"
mkdir -p /tmp/t
mk() { # mk <name> <epoch> [bad]
  tree=/tmp/t/$1; rm -rf "$tree" "/tmp/t/out-$1"; mkdir -p "$tree"; tar xzf /art/cp-*.tar.gz -C "$tree"
  mkdir -p "$tree/wp-content/mu-plugins"; printf "<?php add_action('init', function(){ header('X-Aicc-Release: %s'); });\n" "$1" > "$tree/wp-content/mu-plugins/aicc-probe.php"
  [ "${3:-}" = bad ] && printf '\nthrow new \\Error("boom: deliberately broken release");\n' >> "$tree/wp-content/plugins/aicc-license-manager/aicc-license-manager.php"
  id=$(python3 -I /bundle/infra/release/lib/release_tool.py pack --tree "$tree" --kind cp --out-dir "/tmp/t/out-$1" --epoch "$2" | jq -r .release_id)
  su aicc -c "cp -a $tree $R/.incoming-$id"; cp "/tmp/t/out-$1/cp-$id.manifest.json" "$R/.incoming-$id.manifest.json"; cp "/tmp/t/out-$1/cp-$id.SHA256SUMS" "$R/.incoming-$id.SHA256SUMS"; chown aicc:aicc "$R"/.incoming-$id.*
  echo "$id"
}
t_ok "pre-release backup of the EMPTY database (first deploy) succeeds" aicc-backup --label pre-release
t_eq "...status.json says the restore check was skipped for an empty database" "$(jq -r .db_dump.restore_check /srv/aicc/backups/status.json)" "skipped_empty_database"
ID1=$(ls /art/cp-*.tar.gz | sed 's#.*/cp-##; s#.tar.gz##')
su aicc -c "mkdir -p $R/.incoming-$ID1 && tar xzf /art/cp-$ID1.tar.gz -C $R/.incoming-$ID1"; cp /art/cp-$ID1.manifest.json $R/.incoming-$ID1.manifest.json; cp /art/cp-$ID1.SHA256SUMS $R/.incoming-$ID1.SHA256SUMS; chown aicc:aicc $R/.incoming-$ID1.*
t_ok "first release activates with --allow-uninstalled (real WordPress 7.1.3 loads on PHP 8.3 and reaches its install redirect)" aicc-activate-release --kind cp --release-id "$ID1" --allow-uninstalled --fpm-reload-cmd "$RELOAD"
t_eq "release tree is root-owned" "$(stat -c '%U:%G' "$R/$ID1/index.php")" "root:root"
t_ok "wp core install (WP-CLI 2.12.0 as aicc-cp through the aicc-wp wrapper)" aicc-wp core install --url=https://stage.copilt.org --title="AICC staging" --admin_user=op --admin_email=op@example.org --admin_password="$(openssl rand -hex 12)" --skip-email
t_ok "WooCommerce + AICC plugin activate" aicc-wp plugin activate woocommerce aicc-license-manager
t_ok "AICC theme (child of Storefront) activates" aicc-wp theme activate aicc-admin
t_eq "WordPress 7.1.3 / WooCommerce 10.9.4" "$(aicc-wp core version) $(aicc-wp plugin get woocommerce --field=version)" "7.1.3 10.9.4"
t_ok "smoke-cp passes on the installed site (REST index through FastCGI)" env AICC_RELEASE_DIR=/srv/aicc/cp/current bash /usr/local/lib/aicc/release/smoke-cp.sh
t_ok "the exact command of aicc-wp-cron.service runs clean as aicc-cp" sudo -u aicc-cp -H env WP_CLI_CACHE_DIR=/var/lib/aicc-cp/wp-cli /usr/bin/php /usr/local/bin/wp --path=/srv/aicc/cp/current cron event run --due-now --quiet
# warm OPcache like real traffic and read the numbers that justify opcache.memory_consumption
R1="$(readlink -f /srv/aicc/cp/current)"
for u in "rest_route=/" "" "rest_route=/wc/store/v1/products" "page_id=2" "rest_route=/wp/v2/posts"; do fcgi "$R1/index.php" "$u" /index.php >/dev/null; done
cat > /tmp/probe/o.php <<'PHP'
<?php header("Content-Type: application/json"); $s = opcache_get_status(false); echo json_encode(["used"=>$s["memory_usage"]["used_memory"],"free"=>$s["memory_usage"]["free_memory"],"scripts"=>$s["opcache_statistics"]["num_cached_scripts"],"wasted"=>$s["memory_usage"]["current_wasted_percentage"]]);
PHP
chmod a+r /tmp/probe/o.php; O="$(fcgi /tmp/probe/o.php | tail -1)"
echo "   OPcache after front-end/REST/store warm-up: $(echo "$O" | jq -c '{used_MiB:(.used/1048576|floor), free_MiB:(.free/1048576|floor), scripts, wasted}')"
t_ok "OPcache has headroom: less than 70% of 128 MiB used after warm-up" bash -c "[ \$(echo '$O' | jq '.used*100/(.used+.free)|floor') -lt 70 ]"
echo "   RSS (MiB): $(ps -o rss=,args= -C php-fpm8.3 | awk '{printf "%d ", $1/1024}') (php-fpm master/workers), mysqld $(ps -o rss= -C mysqld | awk '{printf "%d", $1/1024}')"
ID2=$(mk r2 1792700000); aicc-backup --label pre-release >/dev/null 2>&1
t_ok "release 2 activates (dump gate satisfied by a fresh pre-release dump)" aicc-activate-release --kind cp --release-id "$ID2" --fpm-reload-cmd "$RELOAD" --smoke-timeout 20
t_eq "new code is served through the SYMLINK path after swap + reload" "$(hdr /srv/aicc/cp/current)" "r2"
t_eq "previous -> release 1" "$(basename "$(readlink /srv/aicc/cp/previous)")" "$ID1"
ID3=$(mk r3-bad 1792700100 bad); aicc-backup --label pre-release >/dev/null 2>&1
t_rc "a release that fatals under real PHP fails the health gate and is rolled back (exit 3)" 3 aicc-activate-release --kind cp --release-id "$ID3" --fpm-reload-cmd "$RELOAD" --smoke-timeout 8 --smoke-interval 1
t_eq "current is back on release 2 and serving it" "$(basename "$(readlink /srv/aicc/cp/current)") $(hdr /srv/aicc/cp/current)" "$ID2 r2"
t_ok "the failed release is kept and marked" test -f "$R/$ID3.FAILED"
t_ok "manual rollback to release 1" aicc-rollback-release --kind cp --fpm-reload-cmd "$RELOAD"
t_eq "after rollback release 1 is served (no probe header)" "$(basename "$(readlink /srv/aicc/cp/current)") [$(hdr /srv/aicc/cp/current)]" "$ID1 []"
t_ok "rollback again returns to release 2" aicc-rollback-release --kind cp --fpm-reload-cmd "$RELOAD"
. /usr/local/lib/aicc/release/lib/release-common.sh
t_eq "(warm-up through the symlink path, as real traffic through Caddy would)" "$(hdr /srv/aicc/cp/current)" "r2"
atomic_symlink "$R/$ID1" /srv/aicc/cp/current
t_eq "WITHOUT the FPM reload the OLD code is still served through the symlink path (stale OPcache/realpath): the reload is mandatory" "$(hdr /srv/aicc/cp/current)" "r2"
kill -USR2 "$(cat /run/php/php8.3-fpm.pid)"; sleep 1
t_eq "after the graceful reload the swap is visible" "[$(hdr /srv/aicc/cp/current)]" "[]"
atomic_symlink "$R/$ID2" /srv/aicc/cp/current; kill -USR2 "$(cat /run/php/php8.3-fpm.pid)"; sleep 1

echo "== backup with the real WordPress schema on MySQL 8.0, as root over auth_socket"
t_ok "aicc-backup (scheduled) succeeds incl. restore smoke" aicc-backup --label scheduled
t_eq "status.json ok / restore ok" "$(jq -r '.status + " " + .db_dump.restore_check' /srv/aicc/backups/status.json)" "ok ok"
t_eq "53+ tables restored" "$(jq -r '.db_dump.tables >= 50' /srv/aicc/backups/status.json)" "true"
t_ok "aicc-restore-test succeeds" aicc-restore-test
t_eq "the throwaway database is gone" "$(mysql -N -e "SHOW DATABASES LIKE 'aicc_restore_check'" | wc -l | tr -d ' ')" "0"
t_ok "aicc-unit-status writes valid JSON" bash -c "aicc-unit-status ok aicc-backup.service >/dev/null && jq -e '.state==\"ok\"' /var/lib/aicc/status/unit-aicc-backup.service.json"

echo "== the generic edge preflight (stage mode, scripts/ops) accepts our edge.env as the edge's own user"
mkdir -p /srv/aicc/site/releases/x && for f in index.html 404.html 50x.html; do echo a > /srv/aicc/site/releases/x/$f; done; ln -sfn /srv/aicc/site/releases/x /srv/aicc/site/current
PF="$(sudo -u aicc-edge /usr/local/sbin/aicc-edge-preflight --mode stage --caddyfile /tmp/Caddyfile.stage --env-file /etc/aicc-edge/edge.env --caddy /usr/local/bin/caddy --no-validate 2>&1)"
for ok in "preflight ok: mode stage" "preflight ok: php-fpm socket /run/php/aicc-cp.sock" "preflight ok: WordPress docroot /srv/aicc/cp/current" "preflight ok: stage id set" "preflight ok: no public operator CIDR list" "preflight ok: log dir /var/log/aicc-edge writable" "preflight ok: static root"; do
  t_contains "preflight: $ok" "$PF" "$ok"
done
t_contains "(the two remaining failures are the missing real Caddy binary: caddy adapt)" "$PF" "has no 127.0.0.1:8443 listener"

t_summary

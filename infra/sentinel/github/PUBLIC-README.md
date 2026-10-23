# AICC external availability check

This repository holds one small scheduled check. Every 10 minutes (best effort, GitHub may delay a run) a GitHub Actions workflow asks one public address,
`https://www.copilt.org/healthz`, whether the AICC website edge answers: DNS resolves to the expected address, the TLS certificate is valid, and the response is HTTP 200 with the body `ok`.
If two of the last three runs fail it sends a short message to the operator; when the site answers again it sends a recovery message. The workflow run is also marked failed while the site is down.

* `sentinel.py` is the checker (Python standard library only, no dependencies). `targets.toml` is its configuration: a public host name, a public IP address and a URL. There is no secret in this repository.
* The operator's notification credentials are stored as GitHub Actions secrets and reach the checker only as environment variables of the scheduled workflow. They are not part of the repository, are not available to forks, and are masked in logs.
* The workflow runs only on a schedule or by manual dispatch. It does not run on pull requests or issues, and it has read-only repository permissions.
* The run logs are public. They record state changes only (down, recovered, certificate expiry) for the one URL above. Nothing else is probed: no login, checkout, account or admin page, no write request, no cookie.
* `SHA256SUMS` lists the checksums of the files as they were published.

This is an operational convenience for one site. It is not a status page and makes no uptime promise. Issues and pull requests are not monitored.

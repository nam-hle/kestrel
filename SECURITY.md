# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities privately. **Do not open a public issue.**

Use GitHub's [private vulnerability reporting](https://github.com/nam-hle/symantic/security/advisories/new)
to submit a report. We aim to acknowledge reports within 7 days and to provide a
remediation timeline after triage.

When reporting, please include:

- A description of the vulnerability and its impact.
- Steps to reproduce, including affected versions and a minimal example if possible.
- Any known mitigations or workarounds.

## Scope

symantic is read-only and runs no untrusted code or network services. The most
relevant concerns are dependency vulnerabilities and supply-chain integrity.
Dependabot alerts, secret scanning, and CodeQL analysis run on this repository.

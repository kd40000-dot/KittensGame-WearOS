# Kittens Live Sync

Real-time single-writer synchronization for the phone and Wear OS builds.

## Model

- One Cloudflare Durable Object per game session.
- Exactly one device owns the writable game session at a time.
- The owner sends full save commits after meaningful actions and compact live resource snapshots while active.
- The mirror receives live numbers immediately but does not write.
- Switching devices performs a flush-and-handoff, then imports the canonical save once on the newly active device.
- A short lease protects against split-brain when a device drops offline.
- GitHub Plan A remains a temporary recovery path during physical testing only.

## Free deployment

Create a Cloudflare account, then add these GitHub repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Run the **Deploy Kittens Live Sync** workflow. Its output URL will look like:

`https://kittens-live-sync.<account-subdomain>.workers.dev`

The phone initializes the session from its current save. It can then generate a one-time six-digit watch pairing code. The watch claims the code over the internet; no LAN provisioning or GitHub token is required.

## Local tests

```sh
cd live-sync
npm test
```

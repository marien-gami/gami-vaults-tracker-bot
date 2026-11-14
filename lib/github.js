// lib/github.js — Déclenche le workflow "Add vault" et suit son exécution.
//
// Token : fine-grained, limité à ce dépôt, permission "Actions: Read and write".

const API = "https://api.github.com";
const WORKFLOW_FILE = "add-vault.yml";

export function createGithubClient({
  token,
  repo,                       // "owner/name"
  ref = "main",
  fetchImpl = globalThis.fetch
}) {
  async function gh(method, path, body) {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "gami-vaults-tracker-bot"
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000)
    });
    if (res.status === 204) return null;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`GitHub ${method} ${path} : ${res.status} ${json.message ?? ""}`.trim());
    return json;
  }

  // inputs : valeurs EXACTES attendues par le workflow (voir lib/vaultBuilder.js)
  async function dispatchAddVault(inputs) {
    await gh("POST", `/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, { ref, inputs });
  }

  // Retrouve le run grâce au request_id inclus dans son titre (run-name)
  async function findRun(requestId) {
    const json = await gh("GET", `/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=20`);
    return (json.workflow_runs || []).find((r) => (r.display_title || r.name || "").includes(requestId)) ?? null;
  }

  // Attend la fin du run. Renvoie { status: "success"|"failure"|…|"timeout", url }
  async function waitForRun(requestId, { timeoutMs = 10 * 60_000, pollMs = 10_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    const deadline = Date.now() + timeoutMs;
    let run = null;
    while (Date.now() < deadline) {
      await sleep(pollMs);
      try {
        run = await findRun(requestId);
      } catch {
        continue; // erreur réseau passagère
      }
      if (run?.status === "completed") return { status: run.conclusion, url: run.html_url };
    }
    return { status: "timeout", url: run?.html_url ?? `https://github.com/${repo}/actions/workflows/${WORKFLOW_FILE}` };
  }

  return { dispatchAddVault, findRun, waitForRun };
}

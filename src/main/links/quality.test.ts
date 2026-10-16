import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArgRole, ConceptProposal } from "@shared/types";
import { conceptStemKey, containsConcept } from "@shared/links/normalize";
import { buildExtractMessages, verifiedAliases } from "./extract";
import { buildRankMessages, chooseKept, parseRankReply, scoreProposals, shownForRanking } from "./rank";
import { LinksStore } from "./store";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ra-quality-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const doc = "C:\\lib\\2106.02997v2.pdf";
const hash = "sha256:paper";
const passage = (n: number) => ({ chunkId: `${hash}:${n}`, page: n, quote: `quote ${n}` });

function makeStore(): LinksStore {
  return new LinksStore(join(dir, "links.json"), { clock: () => new Date("2026-10-16T10:00:00Z") });
}

describe("extraction prompt", () => {
  const window = { chunkId: "c1", page: 2, text: "Probes are supervised models trained on representations." };

  it("has no language-specific examples and defines aliases narrowly", () => {
    const system = buildExtractMessages(window, [])[0]?.content ?? "";
    expect(system).not.toMatch(/cardinal infini|théorème|ultrafiltre/);
    expect(system).toMatch(/Never translations/);
  });

  it("puts the passage in its place in the argument when a map exists", () => {
    const user = buildExtractMessages(window, [], {
      thesis: "Causal abstraction explains BERT.",
      place: { title: "Probes cannot show causal role", role: "comparison", summary: "Probing is limited." }
    })[1]?.content;
    expect(user).toMatch(/^Document thesis: Causal abstraction explains BERT\.\nThis passage is in "Probes cannot show causal role" \(comparison\): Probing is limited\.\n\nPassage \(p\.2\)/);
    expect(buildExtractMessages(window, [])[1]?.content.startsWith("Passage (p.2)")).toBe(true);
  });

  it("keeps only aliases the passage itself uses, never translations or plurals", () => {
    const text = "Neural representations (NR) are probed. Interchange interventions (IIT) test them.";
    expect(verifiedAliases(["représentations neurales", "NR", "neural representation"], text, "neural representations")).toEqual(["NR"]);
  });
});

describe("plurals and overlapping names", () => {
  it("folds plurals", () => {
    expect(conceptStemKey("causal explanations")).toBe(conceptStemKey("causal explanation"));
    expect(conceptStemKey("causal properties")).toBe(conceptStemKey("causal property"));
    expect(containsConcept("causal abstraction analysis", "causal abstraction")).toBe(true);
    expect(containsConcept("causal abstraction", "causal abstraction")).toBe(false);
  });

  it("merges a plural into the pending singular, keeping the plural as an alias", async () => {
    const store = makeStore();
    await store.addProposals(doc, hash, "qwen", [{ name: "causal explanation", aliases: [], passages: [passage(1)] }], 40);
    await store.addProposals(doc, hash, "qwen", [{ name: "causal explanations", aliases: [], passages: [passage(2)] }], 40);
    const [only, ...rest] = await store.listProposals(doc);
    expect(rest).toEqual([]);
    expect(only?.name).toBe("causal explanation");
    expect(only?.aliases).toContain("causal explanations");
    expect(only?.passages).toHaveLength(2);
  });

  it("matches an existing concept across singular and plural", async () => {
    const store = makeStore();
    const concept = await store.createConcept({ name: "interchange intervention" });
    await store.addProposals(doc, hash, "qwen", [{ name: "interchange interventions", aliases: [], passages: [passage(1)] }], 40);
    expect((await store.listProposals(doc))[0]?.matchConceptId).toBe(concept.id);
  });

  it("offers, but does not make, a merge when one name extends another", async () => {
    const store = makeStore();
    await store.addProposals(doc, hash, "qwen", [{ name: "causal abstraction", aliases: [], passages: [passage(1)] }], 40);
    await store.addProposals(doc, hash, "qwen", [{ name: "causal abstraction analysis", aliases: [], passages: [passage(2)] }], 40);
    const proposals = await store.listProposals(doc);
    expect(proposals).toHaveLength(2);
    const longer = proposals.find((entry) => entry.name === "causal abstraction analysis");
    const shorter = proposals.find((entry) => entry.name === "causal abstraction");
    expect(longer?.similarProposalId).toBe(shorter?.id);
  });
});

describe("pruning", () => {
  it("hides, restores, and does not re-propose what it hid", async () => {
    const store = makeStore();
    await store.addProposals(
      doc,
      hash,
      "qwen",
      ["probing", "causal effect", "integrated gradients"].map((name, at) => ({ name, aliases: [], passages: [passage(at)] })),
      40
    );
    const [keep] = await store.listProposals(doc);
    expect(await store.pruneProposals(hash, [keep?.id ?? ""])).toBe(2);
    expect(await store.listProposals(doc)).toHaveLength(1);
    expect(await store.prunedCount(hash)).toBe(2);

    await store.addProposals(doc, hash, "qwen", [{ name: "causal effects", aliases: [], passages: [passage(9)] }], 40);
    expect(await store.listProposals(doc)).toHaveLength(1);

    expect(await store.restorePruned(hash)).toBe(2);
    expect(await store.listProposals(doc)).toHaveLength(3);
    expect(await store.prunedCount(hash)).toBe(0);
  });
});

describe("ranking", () => {
  function proposal(name: string, chunks: number[], createdAt = "2026-10-16T10:00:00Z"): ConceptProposal {
    return { id: name, docPath: doc, contentHash: hash, name, aliases: [], passages: chunks.map(passage), model: "qwen", createdAt };
  }
  const chunks = [
    { id: `${hash}:1`, text: "Causal abstraction analysis relates a network to a causal model." },
    { id: `${hash}:2`, text: "We use causal abstraction and interchange interventions." },
    { id: `${hash}:3`, text: "Interchange interventions swap representations. A causal effect appears once." },
    { id: `${hash}:4`, text: "Appendix: proofs about causal abstraction." }
  ];

  it("scores extracted and mentioned concepts above one-off phrases", () => {
    const ranked = scoreProposals([proposal("causal effect", [3]), proposal("causal abstraction", [1, 2]), proposal("interchange intervention", [2])], chunks);
    expect(ranked.map((entry) => entry.proposal.name)).toEqual(["causal abstraction", "interchange intervention", "causal effect"]);
  });

  it("tips close cases by the argument role of their passages", () => {
    const roles = (id: string): ArgRole => (id.endsWith(":4") ? "supporting" : "method");
    const ranked = scoreProposals([proposal("appendix idea", [4]), proposal("method idea", [1])], chunks, roles);
    expect(ranked[0]?.proposal.name).toBe("method idea");
  });

  it("honours the model's pick, and falls back to scores when it picks too few or nothing", () => {
    const names = Array.from({ length: 20 }, (_, at) => proposal(`concept ${at}`, [1]));
    const ranked = scoreProposals(names, chunks);
    const shown = shownForRanking(ranked, 8);
    expect(buildRankMessages(shown, 8, { thesis: "T" })[0]?.content).toMatch(/Keep at most 8/);
    const picks = parseRankReply('{"keep":[3, "1", 3, 99, 5, 7, 2, 9]}', shown.length);
    expect(picks).toEqual([2, 0, 4, 6, 1, 8]);
    expect(chooseKept(ranked, shown, picks, 8)).toEqual(picks.map((index) => shown[index]?.proposal.id));
    expect(chooseKept(ranked, shown, [0], 8)).toHaveLength(8);
    expect(chooseKept(ranked, shown, null, 8)).toEqual(ranked.slice(0, 8).map((entry) => entry.proposal.id));
  });
});

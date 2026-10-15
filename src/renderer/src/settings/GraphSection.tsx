import { useEffect, useState } from "react";
import type { GraphSettings, ProviderInfo } from "@shared/types";
import { useSettingsStore } from "@renderer/state/settingsStore";
import { NumberInput, Row, Section, Select, TextInput } from "./fields";

export function GraphSection() {
  const settings = useSettingsStore((state) => state.settings);
  const patch = useSettingsStore((state) => state.patch);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  useEffect(() => {
    let active = true;
    void window.api.providers
      .list()
      .then((list) => {
        if (active) setProviders(list.filter((provider) => provider.configured));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!settings) return null;
  const graph = settings.graph;

  const update = (next: Partial<GraphSettings>): void => {
    const merged: GraphSettings = { ...graph, ...next };
    if (next.extractProviderId === "") delete merged.extractProviderId;
    if (next.extractModel === "") delete merged.extractModel;
    void patch({ graph: merged });
  };

  const provider = providers.find((entry) => entry.id === (graph.extractProviderId ?? settings.activeProviderId));

  return (
    <>
      <Section
        title="Concept links"
        description="How chat connects your documents: [[wiki-links]] and suggestions of related passages in your other indexed PDFs."
      >
        <div className="space-y-3">
          <Row label="Suggest related passages" hint="Under each answer, show matching passages from your other indexed PDFs.">
            <input type="checkbox" checked={graph.relatedSuggestions} onChange={(event) => update({ relatedSuggestions: event.target.checked })} />
          </Row>
          <Row label="Minimum similarity" hint="Higher shows fewer, closer matches (0–1).">
            <NumberInput
              value={graph.relatedMinScore}
              min={0}
              max={1}
              step={0.05}
              onChange={(value) => update({ relatedMinScore: Math.max(0, Math.min(1, value)) })}
            />
          </Row>
          <Row label="Ask the model for [[concepts]]" hint="In Library scope and study mode, key concepts in answers become chips.">
            <input type="checkbox" checked={graph.wikiLinksInChat} onChange={(event) => update({ wikiLinksInChat: event.target.checked })} />
          </Row>
          <Row
            label="Add the model's [[concepts]] automatically"
            hint="Off: they stay dashed suggestions until you click one. Your own [[links]] are always added."
          >
            <input
              type="checkbox"
              checked={graph.commitModelWikiLinks}
              onChange={(event) => update({ commitModelWikiLinks: event.target.checked })}
            />
          </Row>
        </div>
      </Section>
      <Section
        title="Concept extraction"
        description="When you index a document, the model can list its key concepts. They wait in the Links tab for you to edit, merge, accept or reject; nothing is added to the graph until you accept it."
      >
        <div className="space-y-3">
          <Row label="Extract when indexing" hint="Runs one passage at a time; with a small local model this can take several minutes.">
            <input type="checkbox" checked={graph.extractOnIndex} onChange={(event) => update({ extractOnIndex: event.target.checked })} />
          </Row>
          <Row label="Provider" hint="Defaults to the chat provider.">
            <Select value={graph.extractProviderId ?? ""} onChange={(event) => update({ extractProviderId: event.target.value })}>
              <option value="">Same as chat ({settings.activeProviderId})</option>
              {providers.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </Row>
          <Row label="Model" hint="Defaults to the chat model.">
            <TextInput
              list="ra-extract-models"
              value={graph.extractModel ?? ""}
              placeholder={settings.activeChatModel || "model id"}
              onChange={(event) => update({ extractModel: event.target.value })}
              className="w-48"
            />
            <datalist id="ra-extract-models">
              {(provider?.chatModels ?? []).map((model) => (
                <option key={model.id} value={model.id} />
              ))}
            </datalist>
          </Row>
          <Row label="Max concepts per document">
            <NumberInput
              value={graph.maxConceptsPerDoc}
              min={1}
              max={500}
              onChange={(value) => update({ maxConceptsPerDoc: Math.max(1, Math.round(value)) })}
            />
          </Row>
        </div>
      </Section>
    </>
  );
}

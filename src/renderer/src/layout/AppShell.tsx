import { useCallback, useEffect, useRef } from "react";
import {
  Group,
  Panel,
  Separator,
  usePanelRef,
  type Layout,
  type LayoutChangedMeta
} from "react-resizable-panels";
import type { Settings } from "@shared/types";
import { useMediaQuery } from "@renderer/hooks/useMediaQuery";
import { useSettingsStore } from "@renderer/state/settingsStore";
import { DocPane } from "./DocPane";
import { DocTabs } from "./DocTabs";
import { Sidebar } from "./Sidebar";
import { SidePanel } from "./SidePanel";
import { StatusBar } from "./StatusBar";

type UI = Settings["ui"];

const PANEL_ANIMATION_MS = 220;

export function AppShell() {
  const settings = useSettingsStore((state) => state.settings);
  const patchUI = useSettingsStore((state) => state.patchUI);
  const sidebarRef = usePanelRef();
  const panelRef = usePanelRef();
  const narrow = useMediaQuery("(max-width: 767px)");

  const sidebarOpen = settings?.ui.sidebarOpen ?? true;
  const panelOpen = settings?.ui.panelOpen ?? true;
  const sidebarSize = settings?.ui.sidebarSize ?? 20;
  const panelSize = settings?.ui.panelSize ?? 30;

  const ready = settings !== null;
  const groupRef = useRef<HTMLDivElement | null>(null);
  const animateTimer = useRef(0);
  const synced = useRef({ sidebar: false, panel: false });

  // Toggles glide; restoring the saved layout at startup and separator drags do not.
  const animateIfToggle = useCallback(
    (which: "sidebar" | "panel") => {
      if (!ready) return;
      if (!synced.current[which]) {
        synced.current[which] = true;
        return;
      }
      const group = groupRef.current;
      if (!group) return;
      group.setAttribute("data-animating", "");
      window.clearTimeout(animateTimer.current);
      animateTimer.current = window.setTimeout(() => group.removeAttribute("data-animating"), PANEL_ANIMATION_MS);
    },
    [ready]
  );

  useEffect(() => () => window.clearTimeout(animateTimer.current), []);

  useEffect(() => {
    animateIfToggle("sidebar");
    if (sidebarOpen) sidebarRef.current?.expand();
    else sidebarRef.current?.collapse();
  }, [sidebarOpen, sidebarRef, animateIfToggle]);

  useEffect(() => {
    animateIfToggle("panel");
    if (panelOpen) panelRef.current?.expand();
    else panelRef.current?.collapse();
  }, [panelOpen, panelRef, animateIfToggle]);

  const onLayoutChanged = useCallback(
    (layout: Layout, meta: LayoutChangedMeta) => {
      const patch: Partial<UI> = {};
      const sidebar = layout.sidebar;
      const panel = layout.panel;
      if (typeof sidebar === "number" && sidebar > 1) patch.sidebarSize = Math.round(sidebar);
      if (typeof panel === "number" && panel > 1) patch.panelSize = Math.round(panel);
      if (meta.isUserInteraction) {
        if (typeof sidebar === "number") patch.sidebarOpen = sidebar > 0.5;
        if (typeof panel === "number") patch.panelOpen = panel > 0.5;
      }
      if (Object.keys(patch).length > 0) void patchUI(patch);
    },
    [patchUI]
  );

  if (narrow) {
    return (
      <div className="flex h-full flex-col">
        <div className="relative flex min-h-0 flex-1">
          {sidebarOpen ? (
            <>
              <div className="absolute inset-0 z-20 animate-fade-in bg-black/40" onClick={() => void patchUI({ sidebarOpen: false })} />
              <div className="absolute inset-y-0 left-0 z-30 w-64 animate-slide-in-left shadow-xl">
                <Sidebar />
              </div>
            </>
          ) : null}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
            <DocTabs />
            <div className="min-h-0 flex-1">
              <DocPane />
            </div>
          </div>
          {panelOpen ? (
            <>
              <div className="absolute inset-0 z-20 animate-fade-in bg-black/40" onClick={() => void patchUI({ panelOpen: false })} />
              <div className="absolute inset-y-0 right-0 z-30 w-80 animate-slide-in-right shadow-xl">
                <SidePanel />
              </div>
            </>
          ) : null}
        </div>
        <StatusBar />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <Group
          orientation="horizontal"
          className="h-full w-full"
          elementRef={groupRef}
          onLayoutChanged={onLayoutChanged}
        >
          <Panel
            id="sidebar"
            collapsible
            collapsedSize={0}
            minSize="14%"
            defaultSize={`${sidebarSize}%`}
            panelRef={sidebarRef}
            className="min-w-0"
          >
            <Sidebar />
          </Panel>
          <Separator />
          <Panel id="document" minSize="30%" className="min-w-0">
            <div className="flex h-full flex-col bg-bg">
              <DocTabs />
              <div className="min-h-0 flex-1">
                <DocPane />
              </div>
            </div>
          </Panel>
          <Separator />
          <Panel
            id="panel"
            collapsible
            collapsedSize={0}
            minSize="18%"
            defaultSize={`${panelSize}%`}
            panelRef={panelRef}
            className="min-w-0"
          >
            <SidePanel />
          </Panel>
        </Group>
      </div>
      <StatusBar />
    </div>
  );
}

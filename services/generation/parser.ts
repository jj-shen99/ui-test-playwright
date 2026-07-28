/**
 * Dashboard JSON parser (FR-1).
 * Extracts panels, template variables, and rows from a Grafana dashboard JSON model.
 */

export interface ParsedPanel {
  id: number;
  title: string;
  type: string;
  targets: ParsedTarget[];
  datasource?: { type: string; uid: string };
  gridPos?: { h: number; w: number; x: number; y: number };
}

export interface ParsedTarget {
  expr: string;
  legendFormat?: string;
  refId: string;
}

export interface ParsedVariable {
  name: string;
  type: string;
  query?: string;
  datasource?: { type: string; uid: string };
  dependencies: string[];
  includeAll?: boolean;
  multi?: boolean;
}

export interface ParsedDashboard {
  uid: string;
  title: string;
  tags: string[];
  panels: ParsedPanel[];
  variables: ParsedVariable[];
}

/** Parse a raw Grafana dashboard JSON model */
export function parseDashboard(json: Record<string, unknown>): ParsedDashboard {
  const uid = (json.uid as string) || "unknown";
  const title = (json.title as string) || "Untitled";
  const tags = (json.tags as string[]) || [];

  const panels = parsePanels(json.panels as unknown[]);
  const variables = parseVariables(json.templating as Record<string, unknown>);

  return { uid, title, tags, panels, variables };
}

function parsePanels(rawPanels: unknown[] | undefined): ParsedPanel[] {
  if (!Array.isArray(rawPanels)) return [];

  const panels: ParsedPanel[] = [];

  for (const raw of rawPanels) {
    const panel = raw as Record<string, unknown>;

    // Handle row-type panels that contain nested panels
    if (panel.type === "row" && Array.isArray(panel.panels)) {
      panels.push(...parsePanels(panel.panels as unknown[]));
      continue;
    }

    // Skip rows without panels
    if (panel.type === "row") continue;

    const targets = parseTargets(panel.targets as unknown[]);

    panels.push({
      id: panel.id as number,
      title: (panel.title as string) || `Panel ${panel.id}`,
      type: (panel.type as string) || "unknown",
      targets,
      datasource: panel.datasource as ParsedPanel["datasource"],
      gridPos: panel.gridPos as ParsedPanel["gridPos"],
    });
  }

  return panels;
}

function parseTargets(rawTargets: unknown[] | undefined): ParsedTarget[] {
  if (!Array.isArray(rawTargets)) return [];

  return rawTargets.map((raw) => {
    const target = raw as Record<string, unknown>;
    return {
      expr: (target.expr as string) || "",
      legendFormat: target.legendFormat as string | undefined,
      refId: (target.refId as string) || "A",
    };
  });
}

function parseVariables(
  templating: Record<string, unknown> | undefined
): ParsedVariable[] {
  if (!templating) return [];
  const list = templating.list as unknown[];
  if (!Array.isArray(list)) return [];

  return list.map((raw) => {
    const v = raw as Record<string, unknown>;
    const name = (v.name as string) || "";
    const query = typeof v.query === "string" ? v.query : "";

    // Detect dependencies: variables referenced as $varname or ${varname}
    const dependencies = extractVariableRefs(query);

    return {
      name,
      type: (v.type as string) || "query",
      query: query || undefined,
      datasource: v.datasource as ParsedVariable["datasource"],
      dependencies,
      includeAll: v.includeAll as boolean | undefined,
      multi: v.multi as boolean | undefined,
    };
  });
}

/** Extract $variable or ${variable} references from a query string */
function extractVariableRefs(query: string): string[] {
  const refs = new Set<string>();
  const regex = /\$\{?(\w+)\}?/g;
  let match;
  while ((match = regex.exec(query)) !== null) {
    const name = match[1];
    // Exclude built-in Grafana variables
    if (!name.startsWith("__")) {
      refs.add(name);
    }
  }
  return Array.from(refs);
}

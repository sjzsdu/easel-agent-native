import { describe, expect, it } from "vitest";

import {
  EASEL_LAYERS,
  LAYER_LABELS,
  LAYER_ORDER,
  groupSkillsByLayer,
  listEaselSkills,
} from "../../server/lib/skill-catalog.js";

describe("skill-catalog — constants", () => {
  it("EASEL_LAYERS has all 6 layers", () => {
    expect(EASEL_LAYERS).toEqual([
      "discover",
      "plan",
      "produce",
      "publish",
      "attribute",
      "general",
    ]);
  });

  it("LAYER_LABELS has labels for all layers", () => {
    for (const layer of EASEL_LAYERS) {
      expect(LAYER_LABELS[layer]).toBeTruthy();
      expect(typeof LAYER_LABELS[layer]).toBe("string");
    }
  });

  it("LAYER_ORDER puts general first, then workflow layers", () => {
    expect(LAYER_ORDER[0]).toBe("general");
    expect(LAYER_ORDER).toEqual([
      "general",
      "discover",
      "plan",
      "produce",
      "publish",
      "attribute",
    ]);
  });
});

describe("skill-catalog — listEaselSkills", () => {
  it("returns Easel skills (those with layer frontmatter)", () => {
    const skills = listEaselSkills();
    expect(skills.length).toBeGreaterThan(0);

    for (const skill of skills) {
      expect(skill.name).toBeTruthy();
      expect(typeof skill.description).toBe("string");
      expect(EASEL_LAYERS.includes(skill.layer)).toBe(true);
      expect(typeof skill.userInvocable).toBe("boolean");
      expect(skill.dir).toMatch(/^\.agents\/skills\//);
    }
  });

  it("skills are sorted by name", () => {
    const skills = listEaselSkills();
    const names = skills.map((s) => s.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it("contains expected easel domain skills", () => {
    const skills = listEaselSkills();
    const names = skills.map((s) => s.name);
    // Easel skills have bare names in frontmatter (no easel- prefix)
    // even though their directories are prefixed
    expect(names).toContain("audience-profiler");
    expect(names).toContain("card-design");
    expect(names).toContain("hook-generator");
  });

  it("framework skills (no layer) are excluded", () => {
    const skills = listEaselSkills();
    const names = skills.map((s) => s.name);
    // These framework skills should NOT appear since they don't have a layer
    expect(names).not.toContain("actions");
    expect(names).not.toContain("agent-native-docs");
  });
});

describe("skill-catalog — groupSkillsByLayer", () => {
  it("groups skills by layer in LAYER_ORDER", () => {
    const skills = listEaselSkills();
    const groups = groupSkillsByLayer(skills);

    // Groups follow LAYER_ORDER
    const groupLayers = groups.map((g) => g.layer);
    for (let i = 1; i < groupLayers.length; i++) {
      const prevIdx = LAYER_ORDER.indexOf(groupLayers[i - 1]);
      const currIdx = LAYER_ORDER.indexOf(groupLayers[i]);
      expect(prevIdx).toBeLessThan(currIdx);
    }

    // Empty layers are filtered out
    for (const g of groups) {
      expect(g.skills.length).toBeGreaterThan(0);
    }

    // Each skill appears exactly once
    const allSkillNames = groups.flatMap((g) => g.skills.map((s) => s.name));
    expect(new Set(allSkillNames).size).toBe(allSkillNames.length);
    expect(allSkillNames.length).toBe(skills.length);
  });

  it("returns empty array for empty input", () => {
    expect(groupSkillsByLayer([])).toEqual([]);
  });

  it("each group has correct label", () => {
    const skills = listEaselSkills();
    const groups = groupSkillsByLayer(skills);
    for (const g of groups) {
      expect(g.label).toBe(LAYER_LABELS[g.layer]);
    }
  });
});

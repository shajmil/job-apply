// Title-level prefilter for portals that list every role in a park. Only plausible software roles are opened in detail;
// the deterministic and semantic stages still decide fit. Deliberately broad so generic titles are not lost.
const techRole=/developer|engineer|programmer|software|front.?end|back.?end|full.?stack|angular|javascript|typescript|node|mean\b|mern\b|web|\bui\b|ux|technical lead|tech lead|architect|\bsde\b|coder|application|product engineer/i;
export const isTechRole=(title: string)=>techRole.test(title);

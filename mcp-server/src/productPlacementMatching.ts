export interface AffiliateLinkCandidate {
  id: string;
  label: string;
  url: string;
  imageUrl?: string;
}

export function computeUnattachedCandidates(
  allLinks: AffiliateLinkCandidate[],
  attachedIds: Set<string>,
  pendingIds: Set<string>,
): AffiliateLinkCandidate[] {
  return allLinks.filter((link) => !attachedIds.has(link.id) && !pendingIds.has(link.id));
}

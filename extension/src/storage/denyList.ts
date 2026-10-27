export const DENY_LIST_KEY = "deny-list";
export type DenyListEntry = string;
export type DenyList = Set<DenyListEntry>;

// TODO: when adding entry to deny list, strip the www. prefix if present
export function matchesDenyListEntry(url: URL, denyList: DenyList) {
  let host = url.host.toLowerCase();

  if (host.startsWith('www.')) {
    host = host.slice(4);
  } else {
  }
}

export function addToDenyList(denyList: DenyList, location: Location) {
  denyList.add(location.host.toLowerCase());
}

export async function saveDenyList(denyList: DenyList): Promise<void> {
  const denyListArr = [];
  for (const entry of denyList) {
    denyListArr.push(entry);
  }
  await browser.storage.local.set({ [DENY_LIST_KEY]: denyListArr });
}

export async function loadDenyList(): Promise<DenyList> {
  const result = await browser.storage.local.get([DENY_LIST_KEY]);

  if (!Array.isArray(result[DENY_LIST_KEY])) return new Set();
  return new Set(result[DENY_LIST_KEY]);
}

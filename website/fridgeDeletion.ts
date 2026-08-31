// ABOUTME: Defines the fridge word-deletion policy for visitors and the fridge owner.
// ABOUTME: Keeps visitor moderation bounded while allowing the fridge owner cleanup access.
export const DeleteWordLimit = 3;

const FridgeOwnerPublicKey =
  "pk_04934976d2bc13f0a3a1e62a9124a3edb1e236b2eef64b618c646e25e3ade8ec77d2b56bedb39b78150d141be1b6b41a85b86010930941e02e82e96ce61af35d53";

export function canDeleteFridgeWord(
  deleteCount: number,
  publicKey: string | undefined,
): boolean {
  return publicKey === FridgeOwnerPublicKey || deleteCount < DeleteWordLimit;
}

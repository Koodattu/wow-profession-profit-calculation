export function realmLabel(fullName: string): string {
  const names = fullName.split(" / ");
  return names.length > 1 ? `${names[0]} (+${names.length - 1})` : fullName;
}

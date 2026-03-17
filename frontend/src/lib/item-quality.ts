export function getItemQualityClass(quality: number | null | undefined): string {
  switch (quality) {
    case 1:
      return "text-white";
    case 2:
      return "text-green-400";
    case 3:
      return "text-blue-400";
    case 4:
      return "text-purple-400";
    default:
      return "text-foreground";
  }
}

const adminDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Kolkata",
});

export function formatAdminDateTime(value: string) {
  return adminDateTimeFormatter.format(new Date(value));
}

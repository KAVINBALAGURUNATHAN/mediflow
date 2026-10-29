function formatTime(date) {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${ampm}`;
}

function generateSlots(startTime, endTime, duration) {
  if (!startTime || !endTime || !duration || duration <= 0) return [];

  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);

  const base = new Date(1970, 0, 1); // fixed base, no today dependency
  const current = new Date(base);
  current.setHours(startHour, startMinute, 0, 0);
  const end = new Date(base);
  end.setHours(endHour, endMinute, 0, 0);

  if (current >= end) return [];

  const slots = [];
  while (current < end) {
    slots.push(formatTime(current));
    current.setTime(current.getTime() + duration * 60000);
  }
  return slots;
}

module.exports = generateSlots;
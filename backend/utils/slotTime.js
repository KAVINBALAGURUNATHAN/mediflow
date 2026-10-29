// Converts a "09:30 AM" style slot string into minutes since midnight.
function slotToMinutes(slot) {
  const [time, meridiem] = slot.split(" ");
  let [hours, minutes] = time.split(":").map(Number);
 
  if (meridiem.toLowerCase() === "pm" && hours !== 12) {
    hours += 12;
  }
 
  if (meridiem.toLowerCase() === "am" && hours === 12) {
    hours = 0;
  }
 
  return hours * 60 + minutes;
}
 
module.exports = slotToMinutes;
 
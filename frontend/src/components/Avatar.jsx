import ramen from "../assets/avatars/ramen.png";
import udon from "../assets/avatars/udon.png";
import padThai from "../assets/avatars/pad-thai.png";
import yakisoba from "../assets/avatars/yakisoba.png";
import pho from "../assets/avatars/pho.png";

const BOWLS = [ramen, udon, padThai, yakisoba, pho];

// The bowl comes from the friend code, so a person has the same bowl on every friend's laptop.
const pick = (who) => {
  const key = who?.id || who?.name || "";
  const n = /^[0-9a-f]+$/i.test(key) ? parseInt(key.slice(-8), 16) : [...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
  return BOWLS[n % BOWLS.length];
};

export default function Avatar({ who, size }) {
  return (
    <span className={`avatar ${size || ""}`} title={who?.name}>
      <img src={pick(who)} alt="" />
    </span>
  );
}

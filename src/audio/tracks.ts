/**
 * OST track list (VECTOR DRIFT OST VOLUME 1). Files live in public/audio/.
 * `kind` routes playback: "menu" themes play on menus, "aggro"/"chill" while racing.
 */
export type TrackKind = "aggro" | "chill" | "menu";

export interface MusicTrack {
  title: string;
  artist: string;
  src: string;
  kind: TrackKind;
}

const base = import.meta.env.BASE_URL;
const t = (title: string, artist: string, file: string, kind: TrackKind): MusicTrack => ({
  title,
  artist,
  src: `${base}audio/${file}`,
  kind,
});

export const OST: MusicTrack[] = [
  t("BASTARD LANE", "Wan Chai Ghost", "bastard-lane.mp3", "aggro"),
  t("湾岸99", "Kurohako", "wangan-99.mp3", "aggro"),
  t("Brake Later, Pray Earlier", "DJ Battery Acid", "brake-later-pray-earlier.mp3", "aggro"),
  t("怒ってるナビ", "Plastic Dentists", "okotteru-navi.mp3", "aggro"),
  t("nervous system holiday", "Marta Violence", "nervous-system-holiday.mp3", "aggro"),
  t("Shenzhen Dogfight", "3L-BOY", "shenzhen-dogfight.mp3", "aggro"),
  t("YOU ARE NOT INSURED", "Fax Gang Funeral", "you-are-not-insured.mp3", "aggro"),
  t("血液型：COOLANT", "Lainfield", "ketsuekigata-coolant.mp3", "aggro"),
  t("bad lap for nice people", "Otto Chrome", "bad-lap-for-nice-people.mp3", "aggro"),
  t("九龙刹车测试", "Tommy No Signal", "kowloon-brake-test.mp3", "aggro"),
  t("MEATSPACE GRAND PRIX", "Ugly Interface", "meatspace-grand-prix.mp3", "aggro"),
  t("hot rail, cold hands", "DJ終点", "hot-rail-cold-hands.mp3", "aggro"),
  t("crying in the pit lane", "909 Mercy", "crying-in-the-pit-lane.mp3", "aggro"),
  t("PLEASE DAMAGE MY CAR", "Cash4Crash", "please-damage-my-car.mp3", "aggro"),
  t("last place gets deleted", "赤いタクシー", "last-place-gets-deleted.mp3", "aggro"),
  t("menu music for a locked door", "Mellow Threat", "menu-music-for-a-locked-door.mp3", "chill"),
  t("しばらく地獄です", "Aki Bypass", "shibaraku-jigoku-desu.mp3", "chill"),
  t("hotel near the flyover", "Sister Service Station", "hotel-near-the-flyover.mp3", "chill"),
  t("雨、でも人工", "No Carrier Club", "ame-demo-jinko.mp3", "chill"),
  t("sleep mode for criminals", "Minor Accident", "sleep-mode-for-criminals.mp3", "chill"),
  t("Low Battery Buddha", "Neon Rice", "low-battery-buddha.mp3", "chill"),
  t("sponsor screen, 3:17am", "Dial-Up Saint", "sponsor-screen-317am.mp3", "chill"),
  t("自販機の夢", "Glass Taxi", "jihanki-no-yume.mp3", "chill"),
  t("user still missing", "阿短", "user-still-missing.mp3", "chill"),
  t("Parts Counter Romance", "Rook & Static", "parts-counter-romance.mp3", "chill"),
  t("Exit Through Car Park B", "Civic Angel", "exit-through-car-park-b.mp3", "chill"),
  t("武器を選んでね", "Pink Crash Override", "buki-wo-erande-ne.mp3", "chill"),
  t("blue screen at the capsule hotel", "Soft Error Deluxe", "blue-screen-at-the-capsule-hotel.mp3", "chill"),
  t("香港 loading prayer", "Dread Karaoke", "hongkong-loading-prayer.mp3", "chill"),
  t("go home through the service tunnel", "The Late Fee", "go-home-through-the-service-tunnel.mp3", "chill"),
  t("please insert your name", "Glass Taxi", "please-insert-your-name.mp3", "menu"),
  t("welcome to 湾岸天堂", "Sister Service Station", "welcome-to-wangan-tengoku.mp3", "menu"),
];

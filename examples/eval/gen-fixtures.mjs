import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
mkdirSync(dir, { recursive: true });

// Vivid, spec-dense, real-life style inputs. Short ones read like shop pages
// (with rating/shipping/related noise); the *_article ones are full-length
// pages with nav, ads, cookie and related-story boilerplate.
const F = [
  [
    'electronics-01.txt',
    `Acme VoltCore X9 Wireless Noise-Cancelling Headphones — Matte Black
Flagship over-ear with 40mm beryllium drivers, 20Hz–20kHz, 32 ohm, LDAC + AAC.
Hybrid ANC cuts 45dB, transparency mode, 6-mic call array with wind reduction.
Battery: 40h ANC on, 60h off; USB-C fast charge 10 min = 5 h. Multipoint, IPX4.
Folds flat, 254g, memory-foam lambskin earcups. Box: hard case, USB-C, 3.5mm.
★ 4.8 (2,314 ratings) · Free 30-day returns · Ships in 24h · $349 (was $429)
Related: VoltCore X7 $249 · Replacement earpads $29 · Customers also viewed: KlangHaus soundbar`,
  ],
  [
    'electronics-02.txt',
    `BrightPix 27" 4K UHD Monitor for creators and home office. IPS 3840x2160, 144Hz, 1ms GtG, HDR400, 99% sRGB factory calibrated Delta E<2.
Ports: 2x HDMI 2.1, DP 1.4, USB-C 90W power delivery, 2x USB-A hub, 3.5mm out.
Height/tilt/pivot stand, VESA 100x100, flicker-free + low blue light. 45W typical.
Silver aluminum chin, 3-side borderless. In box: DP cable, HDMI, USB-C, power brick.
★ 4.7 (1,089) · 3-year warranty · $429 · Business invoicing available`,
  ],
  [
    'electronics-03.txt',
    `NovaBook Pro 14 Laptop — Space Gray aluminum unibody, 1.45kg, 17.9mm thin.
14.2" 3K IPS 120Hz, 500 nits, 100% DCI-P3. 10-core CPU, 16GB LPDDR5X, 1TB NVMe.
Ports: 2x USB-C TB4, HDMI 2.1, SD UHS-II, 3.5mm. 70Wh battery, 100W GaN charger.
Backlit keyboard, glass touchpad, IR face login, WiFi 6E + BT 5.4. Win 11 Pro.
★ 4.9 (764) · Student discount -10% · Free engraving · $1,299 · Ships free`,
  ],
  [
    'electronics-04.txt',
    `KlangHaus Soundbar 5.1.2 mit Dolby Atmos, 420W Gesamtleistung, kabelloser 8" Subwoofer aus Holz.
11 Treiber, HDMI eARC + 3x HDMI-Eingang, optisch, Bluetooth 5.3, WLAN Multiroom.
Dialogmodus, Nachtmodus, automatische Raumeinmessung per Mikrofon. Wandhalterung inklusive.
Maße 111x11x13cm, 6.8kg. Schwarz matt. ★ 4.6 (3.512) · 899€ · 0%-Finanzierung · Versandkostenfrei`,
  ],
  [
    'home_appliance-01.txt',
    `Acme BrewMaster 15-Bar Espresso Machine, brushed stainless, 1.8L tank, 1350W thermojet heats in 3s.
PID temperature control, 30-setting conical burr grinder, commercial steam wand for microfoam.
58mm portafilter, double-wall + single-wall baskets, hot-water spout for americanos.
32x30x40cm, 9.2kg. 2-year warranty, descaling kit included. Makes 2 espressos + milk daily for a family of four.
★ 4.7 (5,021) · $549 · Free beans 250g this week · Related: tamper set $35, descaler $12`,
  ],
  [
    'home_appliance-02.txt',
    `NordFrost 320L French-Door Refrigerator, inverter compressor, total No-Frost.
Energy class D, 39dB, water + crushed/cubed ice dispenser with filter, 2 VitaFresh humidity drawers.
183x70x68cm, 89kg. Stainless-look doors, recessed handles, reversible? No — fixed hinge left.
Holiday mode, super-freeze, door alarm. ★ 4.5 (842) · €1,099 · Delivery + old-appliance removal €29`,
  ],
  [
    'home_appliance-03.txt',
    `CycloneV Cordless Vacuum, 210AW suction, 60min eco / 25min auto / 12min boost, 0.8L bin.
HEPA H13 traps 99.97% of dust, LCD shows runtime + particle count, 5 heads incl. motorized pet tool + crevice + mattress.
3.1kg in hand, wall dock with charger, washable bin. 55dB eco. Great for 120m² with two cats.
★ 4.6 (9,410) · $299 · Extra battery $79 · 5-year motor warranty`,
  ],
  [
    'home_appliance-04.txt',
    `Máy giặt lồng ngang AquaWash 9.5kg, inverter tiết kiệm điện, 1400 vòng/phút, 15 chương trình giặt.
Giặt hơi nước diệt khuẩn 99.9%, lồng thép không gỉ, kết nối WiFi hẹn giờ qua app.
Cửa kính chịu lực, khóa trẻ em, vệ sinh lồng tự động. 60x60x85cm, 71kg.
Bảo hành động cơ 10 năm. ★ 4.7 (1.530) · 12.490.000đ · Trả góp 0% · Miễn phí lắp đặt`,
  ],
  [
    'furniture_decor-01.txt',
    `Oslo Oak Dining Table — solid white oak, seats 6–8, 200x95x75cm, 42kg.
Oiled matte finish, beveled edge, 5cm overhang each end for end chairs. FSC-certified timber.
Legs detach for moves, assembly ~20 min with included hex key. Wipe with damp cloth, re-oil yearly.
Pairs with Oslo bench 140cm. ★ 4.8 (412) · $899 · White-glove delivery $49 · Swatches free`,
  ],
  [
    'furniture_decor-02.txt',
    `CloudRest L-Shape Sofa, right chaise, off-white bouclé, solid pine frame, sinuous springs.
High-resilience foam + feather-wrapped top cushions, removable machine-washable covers.
268x158x86cm, seat depth 62cm, seat height 44cm. 68kg in two boxes. Pet-friendly weave.
★ 4.6 (638) · €1,499 · 100-night trial · Left-chaise version available`,
  ],
  [
    'furniture_decor-03.txt',
    `Ferrum Industrial Bookshelf — black powder-coated steel uprights, 5 oak-veneer shelves.
180x90x35cm, 28kg, each shelf holds 25kg. Anti-tip wall kit + felt pads included.
Holds ~120 paperbacks per shelf. Assembly 30 min, two people recommended.
★ 4.7 (1,204) · $249 · Matching sideboard $329`,
  ],
  [
    'furniture_decor-04.txt',
    `Nordlicht Stehlampe aus massiver Eiche, Leinenschirm natur Ø35cm, höhenverstellbar 140–180cm.
E27 Fassung, max 12W LED (Leuchtmittel inklusive, 2700K warmweiß), Fußschalter mit Dimmer.
4.8kg, 2m Textilkabel. Perfekt neben Lesesessel oder Sofa. ★ 4.8 (927) · 129€ · 30 Tage Rückgabe`,
  ],
  [
    'apparel_footwear-01.txt',
    `Acme Trail Shell Jacket — forest green 3-layer ripstop nylon, 20k/20k waterproof-breathable, DWR.
Fully taped seams, YKK AquaGuard zips, underarm vents, helmet-compatible adjustable hood.
Relaxed fit, sizes XS–XXL, longer back hem, internal media pocket, RECCO reflector.
Weight 480g (size M). Machine washable. For hiking in sideways rain, not just drizzle.
★ 4.7 (2,876) · $189 · Size guide + model wears M · Free returns 60 days`,
  ],
  [
    'apparel_footwear-02.txt',
    `Velocity Street Runner — men's US 7–13, engineered knit upper with TPU cage, reflective details.
8mm drop, 265g in US 9, nitrogen-infused midsole, full-length rubber with 3mm lugs.
Stack 32/24mm. Best for daily 5–10k on asphalt. Colors: triple black, white/red, sage.
★ 4.6 (4,102) · $139 · Try in store: 5th Ave · Socks bundle -20%`,
  ],
  [
    'apparel_footwear-03.txt',
    `Sienna Linen Summer Dress — terracotta, 100% European flax, OEKO-TEX, midi length, side pockets.
Sizes 34–46, side zip, lined bodice, machine wash cold. Model is 176cm and wears 36.
Wrinkles gracefully — that's linen. ★ 4.8 (1,567) · €119 · Matching belt €25`,
  ],
  [
    'apparel_footwear-04.txt',
    `Giày da Derby nam ClassicBro nâu sẫm — da bò thật full-grain, đế cao su khâu Goodyear chắc chắn.
Size 39–44, lót da thoáng khí, gót 2.5cm, form ôm vừa chân Á Đông. Đánh xi 1 lần/tuần là bóng đẹp.
Bảo hành bong đế 12 tháng, miễn phí thay dây. ★ 4.9 (860) · 1.850.000đ · Tặng xi + bàn chải`,
  ],
  [
    'jewelry_watches-01.txt',
    `Meridian Automatic Watch 40mm — Seiko NH35, 24 jewels, 41h reserve, sapphire front + exhibition back.
316L steel, brushed/polished, 120-click bezel, 5ATM, signed crown. 20mm lugs, 145g on bracelet.
Ships with steel bracelet + cognac leather strap, tool + spring bars. Regulated to -5/+10s/day.
★ 4.9 (1,203) · $359 · Engraving +$20 · 2-year movement warranty`,
  ],
  [
    'jewelry_watches-02.txt',
    `Luna Gold Pendant — 14K solid gold (not plated), 0.3ct lab diamond VS/F in 4-prong setting.
45cm chain, adjustable 40/42.5, lobster clasp. 3.1g total. Gift box + certificate + appraisal.
Nickel-free, hypoallergenic. ★ 4.9 (540) · €549 · Ring-size guide in store`,
  ],
  [
    'jewelry_watches-03.txt',
    `Heritage Chronograph 42mm — quartz Ronda 5030.D, small seconds + 30-min counter, tachymeter bezel.
Cognac leather, deployant clasp, 10ATM, 13.5mm thick, 92g. 5-year battery, Swiss made.
★ 4.7 (388) · $429 · Extra black strap $45`,
  ],
  [
    'jewelry_watches-04.txt',
    `Bague solitaire or blanc 18 carats, diamant 0,5ct taille brillant H/VS2 certifié GIA.
Serti 6 griffes, tour de doigt 48–60 (mise à taille offerte), écrin + certificat.
Garantie à vie contre les défauts. ★ 5,0 (212) · 1 890€ · Paiement 3x sans frais`,
  ],
  [
    'beauty_care-01.txt',
    `GlowLab Vitamin C Serum 30ml — 15% ethylated L-ascorbic acid + 0.5% ferulic + triple hyaluronic.
Fragrance-free, all skin types, AM use under SPF. Glass dropper bottle, 3-month supply at 4 drops/day.
Expect brightness in 2–3 weeks; slight tingle is normal. Store cool, dark. 12-month shelf life.
★ 4.6 (8,930) · $34 · Subscribe -15% · Patch-test guide included`,
  ],
  [
    'beauty_care-02.txt',
    `SilkRepair Argan Hair Mask 200ml — sulfate/paraben/silicone free, for dry, bleached or heat-damaged hair.
Shea + keratin + cold-pressed Moroccan argan, pH 4.5, 5–10 min weekly. Vegan, cruelty-free.
One jar ≈ 12 treatments for shoulder-length hair. ★ 4.7 (3,410) · €22 · Shampoo duo €35`,
  ],
  [
    'beauty_care-03.txt',
    `MatteLock Liquid Lipstick Vault — 6 full-size 3.5ml shades: nude, rose, brick, berry, red, plum.
8h long-wear, no-transfer once set, vitamin E + jojoba so it never cracks. Hypoallergenic, unflavored.
Remove with oil cleanser. ★ 4.5 (12,208) · $27 · Shade-finder quiz · Free returns on unopened`,
  ],
  [
    'beauty_care-04.txt',
    `Kem chống nắng SunShield SPF50+ PA++++, 50ml — kiềm dầu cho da hỗn hợp, nâng tông nhẹ tự nhiên.
Chống nước 80 phút, không cồn, không hương liệu, dùng hàng ngày trước makeup, thoa lại sau 3 giờ ngoài trời.
★ 4.8 (5.672) · 385.000đ · Mua 2 tặng mini 10ml · Freeship`,
  ],
  [
    'food_beverage-01.txt',
    `Acme Dark Chocolate 70% Single Origin Ecuador — 100g bar, tasting notes cherry + tobacco + molasses.
Bean-to-bar, stone-ground 72h. Ingredients: cocoa mass, cane sugar, cocoa butter. Vegan, gluten-free, 590 kcal/100g.
Snap test: clean break, slow melt. ★ 4.9 (2,045) · $6.50 · Tasting flight 5 bars $28`,
  ],
  [
    'food_beverage-02.txt',
    `Highland Roast Whole Bean 1kg — Ethiopia Yirgacheffe arabica, medium roast, roasted every Monday.
Cup: bergamot, jasmine, apricot, silky body. Valve bag, roast date stamped. Espresso 1:2 in 28s or V60 60g/L.
★ 4.8 (3,377) · €24 · Grind service free · Subscription -10%`,
  ],
  [
    'food_beverage-03.txt',
    `Organic Raw Wildflower Honey 500g — unpasteurized, cold-extracted, Provence origin.
Crystallizes naturally (warm jar to liquefy, never microwave). Glass jar, wooden dipper +$3.
Harvest 2024, best before 2027. ★ 4.9 (1,890) · $14 · Comb honey 340g $18`,
  ],
  [
    'food_beverage-04.txt',
    `Trà ô long Alishan 150g — trà cao sơn Đài Loan 1.200m, hương hoa lan, hậu ngọt sâu.
Pha 5g/150ml nước 95°C, tráng nhanh 1 nước, pha 5–7 nước. Hộp thiếc kín khí giữ hương.
HSD 18 tháng, NSX in đáy hộp. ★ 4.9 (743) · 520.000đ · Tặng 3 gói dùng thử`,
  ],
  [
    'health_supplements-01.txt',
    `Omega-3 Fish Oil 1000mg — 120 softgels, EPA 400mg + DHA 300mg per 2-cap serving.
IFOS 5-star certified, lemon flavor, no fishy burps. Dosage 2/day with meals. 2-month supply.
Third-party tested for mercury. ★ 4.7 (6,540) · $24 · Subscribe -15%`,
  ],
  [
    'health_supplements-02.txt',
    `Whey Isolate Vanilla 900g — 27g protein per 30g scoop, 0g sugar, lactose-free, instantized.
30 servings, Informed-Sport certified, mixes lump-free in 15s. Best post-workout within 1h.
★ 4.8 (9,120) · €39 · Shaker free over €40 · Chocolate + unflavored available`,
  ],
  [
    'health_supplements-03.txt',
    `Magnesium Bisglycinate 200mg — 90 chelated tablets, gentle on stomach, no laxative effect.
Take 1–2 before bed for sleep + cramps. Non-GMO, gluten-free, 6-week supply at full dose.
★ 4.6 (4,330) · $19 · Pair with D3+K2`,
  ],
  [
    'health_supplements-04.txt',
    `Vitamin D3 + K2 MK-7 — 60 Kapseln, D3 1000 IE auf Olivenölbasis, K2 als MK-7.
Für Knochen + Immunsystem, 1 Kapsel täglich zum Essen. Laborgeprüft, ohne Zusätze.
Reicht 2 Monate. ★ 4.7 (2,908) · 14,90€ · Abo -10%`,
  ],
  [
    'tools_industrial-01.txt',
    `ProDrill 18V Brushless Impact Driver — 200Nm, 0–3600rpm, 1/4" hex, 3 LEDs.
Kit: 2x 5.0Ah batteries, 45-min rapid charger, belt clip, stackable case. 1.1kg bare.
Drives 8x120mm screws into oak without pilot. 3-year warranty, service centers nationwide.
★ 4.8 (3,220) · $199 · Bare tool $119 · Drill-driver twin kit $299`,
  ],
  [
    'tools_industrial-02.txt',
    `LaserMeasure Pro 100m — ±1.5mm accuracy, area/volume/Pythagoras/stakeout modes.
IP54 dust/splash, backlit 4-line display, Bluetooth sync to floor-plan app. 2x AAA, 122g.
Measures a 40m² flat in minutes. ★ 4.6 (1,540) · €129 · Tripod adapter €19`,
  ],
  [
    'tools_industrial-03.txt',
    `ForgeWeld Inverter Welder 200A — MMA + Lift-TIG, 230V, 60% duty at 200A.
Anti-stick, hot start, arc force, VRD for site work. Leads, mask, brush, 20 electrodes included.
4.9kg, shoulder strap. Runs 3.2mm rods all day. ★ 4.7 (980) · $289 · TIG torch kit $59`,
  ],
  [
    'tools_industrial-04.txt',
    `Werkzeugkoffer Profi 128-teilig — Chrom-Vanadium, 1/4" + 1/2" Ratschen mit 72 Zähnen.
Nüsse 4–32mm, T-Griffe, Bits, Alukoffer mit Einlage. Für Auto + Haushalt + Fahrrad.
25 Jahre Garantie. ★ 4.8 (6,710) · 149€ · Ratenkauf möglich`,
  ],
  [
    'vehicles_parts-01.txt',
    `2019 Aurora GT Coupe 2.0T — 245hp, 8-speed auto, 68,000km, one owner, non-smoker.
Full dealer service history, new Michelin tires + brakes 2024, panoramic roof, heated leather, CarPlay.
No accidents, inspection report + VIN on request. 12-month drivetrain warranty included.
€24,900 · Financing from €349/mo · Trade-in welcome · Viewing in Porto`,
  ],
  [
    'vehicles_parts-02.txt',
    `All-Terrain SUV Tires 265/65R17 112T — M+S + 3PMSF winter rated, set of 4.
1120kg load per tire, 60,000km warranty, DOT 2024, quiet 69dB. Fits Ranger/Hilux/Defender.
Free mounting + balancing in Lisbon, alignment check included. ★ 4.7 (720) · $760/set`,
  ],
  [
    'vehicles_parts-03.txt',
    `Carbon Ceramic Brake Kit, front axle — 380mm discs + 6-piston calipers, braided lines + fluid.
Fits Aurora GT 2017–2022. Saves 11kg unsprung, track-rated to 700°C, 100k km street life.
Bedding guide + torque specs in box. Professional install recommended (4h).
★ 4.9 (156) · €2,990 · Rear kit €2,490`,
  ],
  [
    'vehicles_parts-04.txt',
    `Xe máy điện VoltScoot S — pin lithium 72V 40Ah, quãng đường 120km/lần sạc, sạc 4 giờ.
Tốc độ tối đa 80km/h, phanh đĩa ABS 2 kênh, màn hình TFT, kết nối app định vị + chống trộm.
Bảo hành pin 3 năm, bảo dưỡng miễn phí 1 năm. ★ 4.6 (1.120) · 38.900.000đ · Trả góp 0%`,
  ],
  [
    'sports_outdoor_toys-01.txt',
    `Summit 2-Person Trekking Tent — 20D ripstop sil-nylon fly, DAC aluminum poles, 2.1kg packed.
3000mm HH, bathtub floor, 2 doors + 2 vestibules for packs, freestanding, 12 pegs + lines.
Packs 45x15cm. 3-season, holds in 60km/h gusts. Sets up in 5 min, even solo in wind.
★ 4.8 (1,870) · $279 · Footprint $49 · Repair kit included`,
  ],
  [
    'sports_outdoor_toys-02.txt',
    `AeroR9 Carbon Road Bike 56cm — Shimano 105 Di2 12-speed, hydraulic discs, 8.4kg complete.
50mm carbon tubeless wheels, aero frame, 32mm tire clearance. Rider height 178–186cm.
Free first service + bike fit basic. ★ 4.9 (342) · €2,499 · 0% financing 12x`,
  ],
  [
    'sports_outdoor_toys-03.txt',
    `Neoprene Dumbbell Pair 2x7.5kg — hex anti-roll, knurled chrome handles, floor-friendly coating.
Total 15kg. Ideal for home HIIT + physio. Rack for 3 pairs $39.
★ 4.7 (5,430) · $49 · Full set 2.5–15kg $329`,
  ],
  [
    'sports_outdoor_toys-04.txt',
    `Burg-Bauset für Sammler — 2.480 Teile, ab 14 Jahren, beleuchtetes Tor (USB-C).
4 Minifiguren, Zugbrücke zum Aufklappen, 58x42x39cm aufgebaut. Nummerierte Bauabschnitte, Stoffsegel.
Sammlerbox mit Zertifikat. ★ 4.9 (764) · 179€ · Gratis Versand`,
  ],
  [
    'media_books-01.txt',
    `Hardcover "The Cartographer's Daughter" — E. Marlowe, 2024, historical fiction, 384 pages.
A mapmaker's daughter forges charts that decide a war. 15x23cm, 620g, deckle edges, ribbon marker.
ISBN 978-1-23456-789-0. Signed bookplate while stocks last. ★ 4.6 (8,201) · $28 · Ebook $12`,
  ],
  [
    'media_books-02.txt',
    `Vinyl LP "Midnight Static" — 180g remastered, gatefold + lyric insert + download code.
33rpm, 11 tracks, 48 min indie rock. Limited blue pressing, 2000 numbered copies.
Mastered half-speed. ★ 4.9 (1,130) · €32 · Black vinyl €26`,
  ],
  [
    'media_books-04.txt',
    `Bộ sách Tam Quốc Diễn Nghĩa 6 tập — bìa cứng, dịch full không cắt, 2.850 trang.
Giấy BB 70gsm không lóa, hộp đựng + bookmark vải. NXB Văn Học 2024, hiệu đính kỹ.
★ 4.9 (2.340) · 720.000đ · Bọc plastic miễn phí · Freeship`,
  ],
  [
    'software_app-01.txt',
    `FlowBoard Project Management SaaS — Kanban + Gantt + automations + 200 templates.
Plans: Free (10 users) / Pro $12/user/mo / Enterprise SSO + SLA. Integrates Slack, GitHub, Figma.
SOC2 + GDPR, EU hosting option, 99.99% uptime, 40ms median API. 14-day trial, no card.
★ 4.7 (3.9k reviews) · Onboarding concierge on annual`,
  ],
  [
    'software_app-02.txt',
    `PixelForge Photo Editor v5 — one-time $79, Win/Mac, RAW + AI denoise + object erase.
Perpetual license, 3 seats, all 5.x updates free. Needs 8GB RAM, GPU accel. 30-day full trial.
No subscription, files stay local. ★ 4.8 (11,204) · Upgrade from v4 $39`,
  ],
  [
    'software_app-03.txt',
    `MindfulMe Meditation App — 500+ guided sessions, sleep stories, offline mode, Apple Health + Wear sync.
Premium $59.99/yr, family $89.99 (6 seats). 4.8 stars, 200k reviews. iOS 16+/Android 10+.
7-day free trial, cancel in app. ★ 4.8 · Student -50%`,
  ],
  [
    'software_app-04.txt',
    `ComptaSimple, logiciel de facturation — 19€/mois HT, factures/devis illimités, relances auto.
Conformité Factur-X, multi-utilisateurs, export comptable. Support FR 7j/7 par chat.
Essai 30 jours, sans CB. ★ 4.6 (4.512 avis) · Offre annuelle -20%`,
  ],
  [
    'games_media-01.txt',
    `Starfall Odyssey RPG — PC/PS5/Xbox, open world, 120h main + NG+ with new endings.
Deluxe $79: season pass + mount + OST + artbook. 4K/60, ray tracing, cross-save, photo mode.
PEGI 16. Releases Oct 2026, preload Oct 10. ★ wishlist 2.1M · Standard $59`,
  ],
  [
    'games_media-02.txt',
    `Chrono Clash Mobile — free-to-play gacha battler, 50M downloads, 120fps mode.
Battle pass $9.99/season, pity at 90 pulls, no stamina cap. Controller support, 60fps on 3-year-old phones.
Rated 12+. ★ 4.5 (890k) · Starter pack $0.99`,
  ],
  [
    'games_media-03.txt',
    `Retro Handheld R36S — 3.5" IPS 640x480, 26000 games preloaded on 128GB, HDMI out.
Emulates PS1/GBA/SNES/Genesis, 6h battery, USB-C, save states + rewind. 190g.
★ 4.6 (7,650) · $59 · 64GB version $45 · Case $9`,
  ],
  [
    'games_media-04.txt',
    `"Hafen von Lissabon" — Brettspiel, 2–4 Spieler, 90 Min, ab 12 Jahren.
Worker Placement + Handel, 180 Karten, 40 Holzschiffe, doppelseitiger Spielplan.
Spiel-des-Jahres nominiert. ★ 4.8 (1.209) · 54,90€ · Erweiterung "Sturmflut" 29,90€`,
  ],
  [
    'plan_subscription-01.txt',
    `CloudVault Backup Plan — 2TB $9.99/mo or $99/yr, 5 devices, 180-day versioning.
AES-256, EU/US regions, zero-knowledge option. Family 6TB $19.99. Cancel anytime, 30-day refund.
Setup in 10 min, first backup overnight. ★ 4.7 (5,600) · Business plans from $8/seat`,
  ],
  [
    'plan_subscription-02.txt',
    `StreamFlix Premium 4K — $15.99/mo, 4 screens, offline downloads, no ads, spatial audio.
Annual $159 (2 months free). Student $7.99 with ID. 7-day trial, cancel in 2 clicks.
300+ originals, live sports addon $9.99. ★ 4.4 (210k)`,
  ],
  [
    'plan_subscription-03.txt',
    `FitClub City Center — €39/mo 12-month, off-peak €29, no joining fee this month.
Sauna + 40 classes/week, app booking, freeze 2 months free, 1 guest pass monthly.
Open 6–24h, 200m from metro. ★ 4.5 (1,870) · Day pass €12`,
  ],
  [
    'plan_subscription-04.txt',
    `Gói data SpeedMax 5G — 8GB/ngày, 240GB/tháng, 120.000đ/30 ngày.
Miễn phí data YouTube/TikTok, tặng 60 phút ngoại mạng + 200 SMS. Đăng ký soạn DK gửi 123.
★ 4.6 (9.870) · Gia hạn tự động, hủy *123#`,
  ],
  [
    'media_books-03.txt',
    `DEEP DIVE REVIEW: "Deep Oceans" 3-disc documentary box — 6 episodes, 300 min total.
Stunning 8K trench footage, honest about plastic + noise pollution without preaching.
Narration calm, subtitles EN/FR/DE/ES, region free, booklet with species index.
Disc 3 behind-the-scenes alone worth it. For ages 8+. Our rating 9/10.
--- Around this review: Trending now: "Best nature docs 2026" · "Vinyl vs streaming" · Newsletter signup: weekly picks, unsubscribe anytime · Cookie settings · © MediaVerse ---`,
  ],
  [
    'travel_stay-01.txt',
    `Seaview Boutique Hotel, Algarve — 4-star, 200m from Praia da Rocha, rooftop pool + spa.
Deluxe double €129/night incl. breakfast, sea-view balcony, blackout curtains, Nespresso.
Check-in from 15h, out 12h, free cancellation to 48h. Parking €10/day, airport shuttle €25.
Adults-preferred wing. ★ 4.8 (2,340) · Tourist tax €2/night · Direct booking -10%`,
  ],
  [
    'travel_stay-02.txt',
    `Tokyo 7-Day Rail + Stay — 3* Shinjuku hotel + 7-day JR Pass, flights ex-Lisbon.
2 adults from €1,899: daily breakfast, pocket WiFi, 1 guided day tour, luggage forwarding.
Departures Oct–Nov, cherry-blossom April +€300. Visa-free 90 days for EU passports.
★ 4.9 (410) · Deposit €200 · ATOL-style guarantee`,
  ],
  [
    'travel_stay-03.txt',
    `Alpine Chalet 8 guests — 4BR/3BA, sauna + fireplace, ski-in/ski-out at 1,600m.
€420/night high season, €290 low, cleaning €150, linen + towels included, min stay 5 nights.
Boot warmers, fondue set, sledges. 10 min walk to village bakery. Sleeps 8 + 2 kids.
★ 4.9 (187) · Damage deposit €500 · Dogs welcome +€40`,
  ],
  [
    'travel_stay-04.txt',
    `Tour Hạ Long 2N1Đ du thuyền 5 sao — cabin ban công riêng, kayak + hang Sửng Sốt + làng chài.
Trọn gói 3.290.000đ/khách: xe đưa đón Hà Nội, 4 bữa ăn hải sản, HDV, vé tham quan.
Tàu 12 cabin, điều hòa, wifi. Khởi hành thứ 7 hàng tuần. ★ 4.8 (960) · Trẻ em -50%`,
  ],
  [
    'education_course-02.txt',
    `Piano Beginner Course — 60 video lessons + printable sheets, lifetime access $89.
From first scale to both-hands songs, practice plans 20 min/day, ABRSM Grade 1–2 level.
Feedback community, monthly live Q&A. 4.9/5 from 8k students. Needs any 61+ key keyboard.
★ 4.9 · Gift option · 30-day guarantee`,
  ],
  [
    'education_course-03.txt',
    `IELTS Band 7+ Intensive — 8 weeks, 3 live classes/week + 4 full mock tests with grading.
Small groups max 8, native teachers, writing feedback within 48h. Materials included.
€490. Money-back if no +0.5 band (attendance + homework conditions). Next cohort Nov 10.
★ 4.8 (1,120) · Free placement test`,
  ],
  [
    'education_course-04.txt',
    `Formation Excel avancé — 14h en visio, TCD + Power Query + macros + 1 cas réel.
Certifiante CPF, 4.8/5 (1 200 avis), support + modèles inclus. 890€ HT, finançable OPCO.
Sessions chaque lundi, groupe max 10. ★ 4.8 · Devis entreprise sous 24h`,
  ],
  [
    'event_ticket-01.txt',
    `LIVE: Neon Waves, Altice Arena Lisbon — Dec 12, 21:00, doors 19:30.
Tickets: €45 standard / €85 golden circle / €120 VIP + lounge + merch lane. E-ticket, ID match.
No resale above face value, refund if cancelled. Support: Glasshouse 20:00.
★ 4.9 (fan rating) · On sale Friday 9:00 · Max 4 per person`,
  ],
  [
    'event_ticket-02.txt',
    `Championship Final: North vs South — National Stadium, May 30, 18:00, gates 15:30.
Category 1 $120 / Cat 2 $75 / family zone $40 (kids half). ID required, no bottles, flags ok.
Public transport advised, parking pass $20. ★ 4.8 · Hospitality packages from $290`,
  ],
  [
    'event_ticket-03.txt',
    `Food & Wine Festival 3-Day Pass — Riverside Park, Sep 5–7, 11:00–23:00.
Early bird €59 (reg €79): 40 chefs, tastings incl. 10 tokens, masterclasses +€15.
Kids under 12 free. Rain or shine, covered halls. ★ 4.7 (3,300) · Token top-up at gates`,
  ],
  [
    'event_ticket-04.txt',
    `Show Acoustic Đêm Thu — Nhà hát Hòa Bình, 20h ngày 18/10, mở cửa 19h.
Vé 500k–1.5tr (VVIP meet&greet + poster ký tặng). Mở bán 9h ngày 20/09, tối đa 4 vé/người.
Vé điện tử, không hoàn hủy trừ khi show hủy. ★ 4.9 · Sơ đồ ghế trên web`,
  ],
  [
    'local_service-01.txt',
    `SparkClean Home Cleaning, Lisbon — deep clean from €89 (2BR), eco products, insured team.
Background-checked staff, 48h re-clean guarantee, photos before/after in app.
Book online, same-week slots, English-speaking crews on request. +351 210 123 456.
★ 5.0 (412) · Weekly plan -15% · Move-out cleans from €149`,
  ],
  [
    'local_service-02.txt',
    `RapidFix Plumbing 24/7 — emergency call-out €49 + parts, 1h response in city.
Licensed, 12-month labor warranty. Leak detection, boilers, drains, bathroom refits.
Upfront quote before work, card + invoice. Open holidays. ★ 4.9 (1,940)`,
  ],
  [
    'local_service-03.txt',
    `Pawsome Dog Grooming — full groom small €35 / large €55: bath + cut + nails + ears.
Certified groomers, hypoallergenic shampoo, no-cage drying. Tue–Sat 9–18, booking online.
De-shedding +€10. ★ 5.0 (400+) · Puppy intro session €20`,
  ],
  [
    'local_service-04.txt',
    `Dịch vụ sửa điều hòa tại nhà — vệ sinh 150k/máy, bơm gas 450k, thay tụ 300k.
Có mặt 30 phút nội thành, bảo hành 6 tháng, hóa đơn rõ ràng. Làm cả cuối tuần, lễ.
Hotline 8h–20h. ★ 4.8 (2.150) · Vệ sinh 3 máy tặng 1`,
  ],
  [
    'real_estate-01.txt',
    `Sunny 3-bedroom townhouse, Lisbon — 128m² over two floors + 30m² rooftop terrace, city views.
Renovated 2021: oak floors, marble kitchen with island, 2.5 baths, private garage + storage.
Double glazing, AC, solar panels. Energy C. Quiet street, metro 5 min, schools nearby.
€685,000 · Agency fee included · Virtual tour + floor plan online`,
  ],
  [
    'real_estate-02.txt',
    `Studio 38m² near university — furnished, 2nd floor with elevator, juliet balcony.
Rent €850/mo + €60 charges (water, building, internet). Deposit 2 months. Available Oct 1.
Pets negotiable, washing machine + dishwasher. Landlord speaks EN. Viewing Sat 10–13h.`,
  ],
  [
    'real_estate-03.txt',
    `Country villa with pool — 4BR/3BA on 1,200m² plot, olive trees, mountain view, 15 min to coast.
Built 2008, renovated 2022: solar + heat pump, guest annex, outdoor kitchen, 8x4m pool.
Borehole + mains water. €890,000 · Habitation license · Video tour on request`,
  ],
  [
    'real_estate-04.txt',
    `Căn hộ 2PN 68m² Riverside — tầng 12 view sông, full nội thất cao cấp, ban công Đông Nam.
Giá 3.2 tỷ, sổ hồng sẵn, phí quản lý 12k/m². Bàn giao ngay, hỗ trợ vay 70%, ân hạn 12 tháng.
Tiện ích: hồ bơi, gym, trường quốc tế. Xem nhà cuối tuần.`,
  ],
  [
    'organization_person-01.txt',
    `GreenHarbor Foundation — ocean-plastic nonprofit, founded 2016, HQ Porto, 120 staff.
12k volunteers, 40 cleanup hubs in 9 countries, 800t plastic removed 2024. Audited accounts + annual report online.
Donate monthly from €5, corporate cleanups, school program. Contact: hello@greenharbor.example.
Press kit + impact dashboard linked below.`,
  ],
  [
    'organization_person-02.txt',
    `Dr. Elena Ruiz, cardiologist — 15y experience, Hospital Central, 200+ peer citations.
Prevention + sports cardiology, speaks EN/ES/PT. Consultation €120, Tue/Thu, via clinic portal.
No emergency bookings — call 112. Patient rating 4.9 (600+).`,
  ],
  [
    'organization_person-03.txt',
    `PixelWorks Studio — 25-person branding agency, est. 2014, Lisbon + remote.
Identity, web, packaging for fintech + retail. Selected work + process online, quotes in 48h.
hello@pixelworks.example, +351 213 000 000. Currently booking Q1.`,
  ],
  [
    'organization_person-04.txt',
    `Công ty TNHH An Phát Logistics — 300 nhân sự, 3 kho 20.000m² tại Bình Dương.
Vận chuyển Bắc–Nam 24–48h, tracking realtime, bảo hiểm 100%. Báo giá trong 2 giờ làm việc.
Tuyển 20 tài xế + 10 NV kho, xem mục tuyển dụng.`,
  ],
  [
    'job_listing-01.txt',
    `Senior Frontend Engineer (React) — remote EU, €70–90k + equity, async culture.
5y+ TypeScript, design systems, testing, performance. 33 days off, home-office budget €2k.
Apply with CV + portfolio link. No agencies. Response within 10 days. About us: 120-person SaaS, profitable.`,
  ],
  [
    'job_listing-02.txt',
    `Barista full-time — Blue Cup Cafe downtown, $18/h + tips, weekend rotation with days off.
1y experience, latte art a plus. Free coffee + meals, training path to head barista.
Start ASAP. Apply in person Tue–Thu with CV. Family-run, 8 staff.`,
  ],
  [
    'job_listing-03.txt',
    `Data Analyst Intern 6 months — paid €900/mo, hybrid Porto, mentorship + thesis support.
SQL + Excel required, Python a plus. Real dashboards from week 2, reference letter.
Send CV in English, one page. Start Oct/Nov.`,
  ],
  [
    'job_listing-04.txt',
    `Tuyển 5 NV CSKH tiếng Anh — lương 12–15tr + thưởng, làm việc tại Q.1.
Toeic 700+, ca xoay 8h, BHXH đầy đủ, đào tạo 2 tuần có lương. PV online, nhận việc trong 2 tuần.
Môi trường trẻ, sếp dễ tính, team 30 người.`,
  ],
  [
    'education_course-01.txt',
    `Data Science Bootcamp — 12 weeks online, Python + ML + portfolio + career coaching.
Week 1–4 Python/pandas/SQL, 5–8 ML scikit-learn, 9–10 deep learning intro + 3 portfolio projects, 11–12 interviews.
Live cohorts max 25, TAs + 1:1 mentor, certificate + hiring partners (40 companies).
$2,900 or 3x$990, income-share option. Next start Nov 3, part-time track available.
Beginner friendly: free 20h prep course. 4.8/5 (2,300 grads), 78% hired in 6 months.
Syllabus PDF + alumni outcomes report below. FAQ: time 15h/week, refund week 1, English B2.
Apply: 15-min call + logic test, no coding experience needed.`,
  ],
  [
    'news_analysis-01.txt',
    `City council approves new riverside park — 12 hectares with native planting, vote 7–2 Tuesday.
Construction starts spring, two phases over 30 months, budget €18M with €4M EU green fund.
Phase 1: floodplain meadow + 3km paths + playground. Phase 2: amphitheater + wetlands boardwalk.
Mayor: "largest green space in a generation". Critics cite the 2022 pool overrun (+40%) and demand quarterly audits.
What happens next: tender in January, groundbreaking March, first meadow opens autumn next year.
--- Page furniture: TechDaily Home | News | Sport | Weather | Sign in | Search
Cookie notice: we value your privacy [Accept all] [Settings]
Ad: Switch energy, save €300 — compare now
Related: Downtown traffic changes next month · Pool inquiry report: full text · 5 riverside cafes to try
Most read: 1. Metro line delay 2. Derby tickets 3. Storm warning
Comments (48): "Finally!" ... [Join the discussion] · Footer: About · Contact · Privacy · © 2026 ---`,
  ],
  [
    'news_analysis-02.txt',
    `Central bank holds rates at 3.5% for third straight meeting, citing sticky services inflation at 4.1%.
Statement: "policy remains restrictive; future moves data-dependent". Analysts split: half see a December cut to 3.25%, half expect hold into spring.
Markets muted: euro steady at 1.08, bond yields +3bp. Mortgage holders: illustration — €250k variable loan pays ~€38 more than 2022.
Background: hikes began 2022 from -0.5%, last cut June. Full statement + staff projections attached (PDF, 12pp).
What to watch: wage data Oct 28, inflation flash Nov 2, next meeting Dec 11.
--- Page furniture: Markets Home | Stocks | Currencies | Sign in
Ad: Trading involves risk — 74% lose money
Related: Housing starts fall 6% · ECB minutes explained · Savings accounts compared
Newsletter: Markets Daily, free, unsubscribe anytime · Cookie settings · © 2026 ---`,
  ],
  [
    'news_analysis-03.txt',
    `Study: Mediterranean diet linked to 23% lower cardiac risk — 10-year cohort, 25,000 adults, peer-reviewed, published Tuesday.
High adherence group saw fewer events after adjusting for age, smoking, exercise. Olive oil + nuts drove most signal; wine neutral.
Lead author: "association, not proof — but consistent with trials". Critics note food questionnaires + healthy-user bias.
What it means: vegetables, legumes, fish, olive oil; no need for exotic supplements. Full paper + editorial linked.
--- Page furniture: Health Home | Nutrition | Fitness | Sign in
Ad: DNA diet test — 50% off this week
Related: Ultra-processed foods study · 20-min weeknight recipes · Sleep and heart risk
Comments (112) · Cookie settings · © 2026 ---`,
  ],
  [
    'news_analysis-04.txt',
    `Chính phủ phê duyệt tuyến metro số 3 kéo dài 8km với 7 ga mới, tổng vốn 1,2 tỷ euro.
Khởi công 2027, khai thác 2031, nối trung tâm với khu công nghệ phía tây, dự báo 180.000 lượt/ngày.
80% vốn vay ưu đãi, 20% ngân sách. Chuyên gia lo tiến độ giải phóng mặt bằng + đội vốn như tuyến 1 (+35%).
Tiếp theo: thiết kế kỹ thuật 2026, đấu thầu gói hầm. Người dân được lấy ý kiến vị trí 3 ga.
--- Thanh trang: Trang chủ | Thời sự | Kinh tế | Đăng nhập | Tìm kiếm
Quảng cáo: Mở thẻ hoàn tiền 2 triệu
Tin liên quan: Kẹt xe cửa ngõ · Giá vé metro · Quy hoạch 2030
Bình luận (36) · Cookie · © 2026 ---`,
  ],
  [
    'science_knowledge-01.txt',
    `How photosynthesis works, simply: plants turn light + CO2 + water into sugar.
Light reactions (thylakoids): chlorophyll catches photons, splits water (oxygen out), makes ATP + NADPH.
Calvin cycle (stroma): Rubisco fixes CO2 onto RuBP, ATP/NADPH build G3P — some becomes glucose, rest recycles.
Efficiency only 3–6%: most light missed, photorespiration wastes energy in heat. C4 plants (corn) do better.
Why it matters: every joule of food + fossil fuel is old sunlight; engineers copy it for solar fuels.
Try at home: leaf + sunlight + iodine turns starch blue-black — full protocol + safety notes below.
--- Page furniture: Learn Home | Biology | Chemistry | Physics | Search
Ad: Tutoring from €19/h — first lesson free
Related: Cellular respiration explained · Why leaves turn red · Build a mini greenhouse
Quiz: 5 questions · Worksheet PDF · Cookie settings · © 2026 ---`,
  ],
  [
    'science_knowledge-02.txt',
    `Black holes, explained: a region where escape velocity exceeds light speed past the event horizon.
Stellar-mass (5–100 suns) from collapsed giants >20 solar masses; supermassive (millions–billions) anchor galaxy centers, ours Sagittarius A* is 4.3M.
We "see" them via accretion glow + bent starlight; 2019 imaged M87*'s shadow, 2022 ours. Hawking radiation lets them slowly evaporate.
No-hair theorem: mass, spin, charge describe them fully. Spaghettification stretches infallers; time dilates to a stop at the horizon (outside view).
Open questions: information paradox, singularities, what the 2026 pulsar-timing data means.
--- Page furniture: Learn Home | Space | Search
Ad: Telescope deals — up to 30% off
Related: Neutron stars · Gravitational waves 101 · Webb's best photos
Glossary: 12 terms · Cookie settings · © 2026 ---`,
  ],
  [
    'science_knowledge-03.txt',
    `How mRNA vaccines work: lipid nanoparticles carry spike-protein instructions into arm muscle cells.
Ribosomes translate mRNA, cells display spike fragments, immune system learns them — antibodies + T-cells.
mRNA never enters the nucleus, alters no DNA, degrades in days. Early versions needed -70°C; newer ones fridge-stable.
Side effects: sore arm, 1–2 days fatigue/fever = immune response working. Myocarditis rare, mostly young males, monitored.
Timeline: 1960s research → 2020 trials of 70k people → billions dosed, safety tracked continuously.
Sources: trial papers + regulator dashboards linked. FAQ: fertility, pregnancy, kids — evidence summaries.
--- Page furniture: Learn Home | Health | Search
Ad: Pharmacy delivery in 2h
Related: How boosters were updated · Reading a trial paper · Vaccine timeline graphic
Cookie settings · © 2026 ---`,
  ],
  [
    'science_knowledge-04.txt',
    `Hiệu ứng nhà kính, giải thích đơn giản: CO2, CH4, N2O hấp thụ bức xạ hồng ngoại từ mặt đất rồi bức xạ lại.
Không có nó, Trái Đất lạnh -18°C; quá nhiều thì nóng lên. CO2 vượt 420ppm năm 2024 (thời tiền công nghiệp 280ppm).
Mô hình dự báo +1.5–2°C nếu không cắt giảm sâu: nước biển dâng, nắng nóng, mưa cực đoan.
Giải pháp: điện sạch, xe điện, giảm lãng phí thực phẩm, rừng. Mỗi phần việc đều có số liệu bên dưới.
Thí nghiệm: 2 chai, 1 giàu CO2 dưới nắng — chênh 2–3°C, hướng dẫn + an toàn kèm theo.
--- Thanh trang: Học tập | Vật lý | Tìm kiếm
Quảng cáo: Khóa học IELTS
Liên quan: Năng lượng mặt trời · Phân loại rác · Tiết kiệm điện
Cookie · © 2026 ---`,
  ],
  [
    'general-01.txt',
    `Acme Multitool Pen — writes, opens bottles, has LED light + stylus tip, ruler edge.
Gift box included. Handy for travel and office. Popular this season!
Buy 2 get 1 free this week. ★ 4.5 (312)`,
  ],
  [
    'general-02.txt',
    `Something nice for your home — cozy, stylish and affordable.
Everyone loves it, great gift idea. Buy now while stocks last!
Free gift wrapping this month.`,
  ],
  [
    'general-03.txt',
    `Welcome to our spring collection full of surprises and fresh ideas.
Discover more in store and online. Follow us for updates!
New arrivals every Friday.`,
  ],
  [
    'general-04.txt',
    `Super Angebot — schnell, günstig, unglaublich gut!
Jetzt kaufen, nur kurze Zeit! Alles muss raus, beste Qualität versprochen!
Nur solange Vorrat reicht.`,
  ],
];
for (const [name, text] of F) writeFileSync(join(dir, name), text + '\n');
console.log(`wrote ${F.length} fixtures to ${dir}`);

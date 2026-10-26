import type { Rng } from '../rng';
import type { SettlementKind } from '../terrain';

const SURNAMES = [
  'Han', 'Seo', 'Baek', 'Gu', 'Mu', 'Yu', 'Jin', 'Ryu', 'Choi', 'Kang', 'Lee', 'Park', 'Hwang', 'Wi', 'Namgung',
  'Jegal', 'Dokgo', 'Hyeon', 'Sa', 'Yeon', 'Yang', 'Cheon', 'Gwak', 'Shin', 'Moon', 'Jo', 'Ahn', 'Noh', 'Bae', 'Song',
];

const GIVEN_A = ['Cheong', 'Myeong', 'Hyuk', 'Woon', 'Sung', 'Do', 'Min', 'Jae', 'Ha', 'Rok', 'Gyeol', 'Hwan', 'Seol', 'Ryeon', 'Mu', 'Yeong', 'Tae', 'Jun', 'Hae', 'Ju', 'Seon', 'Baram', 'Gang', 'Hyang', 'Eun', 'Wol'];
const GIVEN_B = ['gyeom', 'hyeon', 'woo', 'jin', 'rim', 'san', 'ho', 'seong', 'ryong', 'ran', 'hee', 'bin', 'an', 'yeon', 'soo', 'mun', 'gi', 'cheol', 'jun', 'wol', 'young', 'sik'];

export function personName(rng: Rng): string {
  return `${rng.pick(SURNAMES)} ${rng.pick(GIVEN_A)}${rng.pick(GIVEN_B)}`;
}

const TITLES_GOOD = ['the Iron Fist', 'Cloud-Walker', 'the Jade Blade', 'Thousand-Li Palm', 'the Merciful', 'Heaven\'s Sword', 'the Steadfast', 'Spring Rain'];
const TITLES_DARK = ['the Blood Lotus', 'Nine-Fang', 'the Pale Hand', 'Black Wind', 'the Hollow King', 'Demon Sword', 'the Ashen', 'Night Crane'];

export function legendTitle(rng: Rng, dark: boolean): string {
  return rng.pick(dark ? TITLES_DARK : TITLES_GOOD);
}

const PREFIX = [
  'Cloud', 'Jade', 'Iron', 'Willow', 'Red', 'Azure', 'Mist', 'Silent', 'Golden', 'Black', 'White', 'Crane', 'Dragon',
  'Tiger', 'Plum', 'Bamboo', 'Frost', 'Autumn', 'Moon', 'Thunder', 'Stone', 'Lotus', 'Phoenix', 'Pine', 'River', 'Sun',
];

const SUFFIX: Record<SettlementKind, string[]> = {
  village: ['Village', 'Brook', 'Meadow', 'Ford', 'Glen'],
  hamlet: ['Hamlet', 'Rest', 'Farm', 'Cottage'],
  town: ['Market', 'Crossing', 'Harbor', 'Gate', 'Town'],
  fort: ['Fort', 'Pass', 'Bastion', 'Watch'],
  sectHall: ['Peak', 'Temple', 'Summit', 'Cliff'],
  ruin: ['Ruins', 'Capital', 'Citadel'],
};

export function settlementName(rng: Rng, kind: SettlementKind, used: Set<string>): string {
  for (let i = 0; i < 60; i++) {
    const name =
      kind === 'ruin'
        ? `Fallen ${rng.pick(PREFIX)} ${rng.pick(SUFFIX.ruin)}`
        : `${rng.pick(PREFIX)} ${rng.pick(SUFFIX[kind])}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `${rng.pick(PREFIX)} ${rng.pick(SUFFIX[kind])} ${used.size}`;
  used.add(fallback);
  return fallback;
}

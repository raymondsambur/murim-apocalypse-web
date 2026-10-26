/**
 * Rumor telling. A rumor sentence is: hedge (how sure the teller sounds, from the rumor's truth) wrapped around a body clause
 * (what happened, per rumor kind; written to follow "that ..."), plus an optional reaction closer by the teller's traits.
 * Body clauses start lowercase or with a slot; the composer capitalises the final sentence.
 */
import { buildFragments, g, type DlgGroup } from './types';

const BODIES: DlgGroup[] = [
  g({ rumor: 'siege' }, '{rumor.faction} has laid siege to {rumor.place}', '{rumor.place} is under siege by {rumor.faction}', 'riders under {rumor.faction} banner have ringed {rumor.place}', '{rumor.faction} has camped outside the walls of {rumor.place}'),
  g({ rumor: 'siege' }, 'about {rumor.n} fighters of {rumor.faction} ring {rumor.place}'),
  g({ rumor: 'hollowSiege' }, 'the Hollows have surrounded {rumor.place}', 'a tide of Hollows is at the gates of {rumor.place}', '{rumor.place} has shut its gates against a Hollow horde', 'the dead walk outside {rumor.place}'),
  g({ rumor: 'hollowSiege' }, 'some {rumor.n} Hollows were counted at the walls of {rumor.place}'),
  g({ rumor: 'held' }, '{rumor.place} held against the siege', 'the walls of {rumor.place} did not break', '{rumor.place} drove the attackers off, {rumor.age}', 'the defenders of {rumor.place} stood firm'),
  g({ rumor: 'fell' }, '{rumor.place} has fallen to the Blight', 'nobody is left alive in {rumor.place}; the Blight took it', '{rumor.place} is a ruin now', 'the gates of {rumor.place} burned and the Hollows walk its streets', '{rumor.place} was lost {rumor.age}'),
  g({ rumor: 'captured' }, '{rumor.faction} seized {rumor.place}', '{rumor.place} now answers to {rumor.faction}', '{rumor.faction} banners fly over {rumor.place} now', '{rumor.place} changed hands, and {rumor.faction} holds it now'),
  g({ rumor: 'plundered' }, '{rumor.faction} raiders plundered {rumor.place} and rode off', '{rumor.place} was stripped of its grain by {rumor.faction}', '{rumor.faction} hit {rumor.place} hard, and left it hungry'),
  g({ rumor: 'retaken' }, '{rumor.faction} took {rumor.place} back from the Blight', '{rumor.place} has been reclaimed', 'folk are returning to the ruins of {rumor.place}', 'someone is lighting hearths again in {rumor.place}'),
  g({ rumor: 'famine' }, 'famine grips {rumor.place}', '{rumor.place} is starving', 'there is no grain left in {rumor.place}', 'the folk of {rumor.place} are eating bark and boiled leather'),
  g({ rumor: 'famineEnd' }, 'the famine in {rumor.place} has eased', '{rumor.place} has bread again', 'grain finally reached {rumor.place}'),
  g({ rumor: 'plague' }, 'a wasting fever has broken out in {rumor.place}', 'plague is loose in {rumor.place}', 'they are burning houses in {rumor.place} to stop the sickness', 'the sick of {rumor.place} outnumber the healthy'),
  g({ rumor: 'plagueEnd' }, 'the plague in {rumor.place} has burned itself out', 'the fever in {rumor.place} is spent'),
  g({ rumor: 'festival' }, '{rumor.place} is holding a festival', 'there are lanterns and drums in {rumor.place}', 'folk are dancing in the streets of {rumor.place}'),
  g({ rumor: 'boom' }, 'trade booms in {rumor.place}', '{rumor.place} is rich as ever this season', 'the markets of {rumor.place} overflow'),
  g({ rumor: 'hardTimes' }, 'hard times have come to {rumor.place}', '{rumor.place} is struggling', 'folk are leaving {rumor.place}'),
  g({ rumor: 'npcDeath' }, '{rumor.who} has died', '{rumor.who} of {rumor.place} is dead', 'they buried {rumor.who} in {rumor.place}', '{rumor.who} is gone, {rumor.age}'),
  g({ rumor: 'legendRise' }, '{rumor.who} is now counted among the legends', '{rumor.who} has earned a place among the legends of the martial world', 'a new name has joined the legends: {rumor.who}'),
  g({ rumor: 'legendSeen' }, '{rumor.who} was seen in {rumor.place}', 'the legend {rumor.who} passed through {rumor.place}', 'someone swears they saw {rumor.who} near {rumor.place}'),
  g({ rumor: 'newMaster' }, '{rumor.who} has come to teach at {rumor.place}', '{rumor.place} has a new master, {rumor.who}', 'there is a new face on the training ground of {rumor.place}: {rumor.who}'),
  g({ rumor: 'heartSealed', about: 'other' }, '{rumor.who} sealed a Blight heart near {rumor.place}', 'a Blight heart near {rumor.place} was sealed by {rumor.who}', 'it was {rumor.who} who sealed the heart near {rumor.place}'),
  g({ rumor: 'heartSealed', about: 'self' }, 'you sealed a Blight heart near {rumor.place}', 'it was you who sealed the heart near {rumor.place}, {rumor.age}'),
  g({ rumor: 'heartWounded' }, 'someone wounded the Blight heart near {rumor.place}', '{rumor.who} struck the Blight heart near {rumor.place}'),
  g({ rumor: 'heartStirs' }, 'the Blight heart near {rumor.place} stirs again', 'the sealed heart near {rumor.place} woke', 'black mist rolls from the heart near {rumor.place}'),
  g({ rumor: 'blightAdvance' }, 'the Blight has crept up to {rumor.place}', 'grey mist presses on the walls of {rumor.place}', 'the fields around {rumor.place} are turning grey'),
  g({ rumor: 'blightRecede' }, 'the Blight is retreating from {rumor.place}', 'the mist around {rumor.place} thinned, {rumor.age}'),
  g({ rumor: 'roadBlocked' }, 'the road between {rumor.place} and {rumor.place2} is choked with Blight', 'no caravans move between {rumor.place} and {rumor.place2}', 'the carters will not take the road to {rumor.place2} now'),
  g({ rumor: 'caravan' }, 'caravans run again between {rumor.place} and {rumor.place2}', 'a caravan hauled {rumor.n} loads to {rumor.place}', 'carts are rolling between {rumor.place} and {rumor.place2} again'),
  g({ rumor: 'war' }, '{rumor.faction} has declared war on {rumor.faction2}', '{rumor.faction} and {rumor.faction2} are at each other\'s throats', 'there will be blood between {rumor.faction} and {rumor.faction2}'),
  g({ rumor: 'truce' }, '{rumor.faction} and {rumor.faction2} agreed to a truce', '{rumor.faction} and {rumor.faction2} laid down their blades, for now'),
  g({ rumor: 'alliance' }, '{rumor.faction} and {rumor.faction2} have sworn an alliance', '{rumor.faction} has a new friend in {rumor.faction2}'),
  g({ rumor: 'uprising' }, 'the people of {rumor.place} rose against {rumor.faction}', '{rumor.place} has thrown off its masters', 'there was blood in the streets of {rumor.place}, and the garrison lost'),
  g({ rumor: 'refugees' }, 'refugees from {rumor.place} are on the road', 'survivors of {rumor.place} are stumbling toward the next town', 'the folk of {rumor.place} are fleeing, carrying what they can'),
  g({ rumor: 'expedition' }, 'an expedition of {rumor.faction} was lost to the Hollows near {rumor.place}', '{rumor.faction} sent warriors against the heart near {rumor.place}, and few returned'),
  g({ rumor: 'playerDeed', about: 'other' }, '{rumor.who} {rumor.deed}', '{rumor.who} {rumor.deed}, near {rumor.place}', 'a fighter named {rumor.who} {rumor.deed}, {rumor.age}'),
  g({ rumor: 'playerDeed', about: 'self' }, 'you {rumor.deed}', 'you {rumor.deed}, near {rumor.place}', 'someone from {rumor.place} says you {rumor.deed}'),
  g({ rumor: 'misc' }, 'something strange is going on near {rumor.place}', 'folk in {rumor.place} are whispering about a thing they won\'t name'),
];

const HEDGES: DlgGroup[] = [
  g({ hedge: 'sure' }, '{body}. That much is certain.', 'No doubt about it: {body}.', 'I will swear to this: {body}.', '{body}, plain as day.', 'Mark me, {player}: {body}.', 'It is true: {body}.'),
  g({ hedge: 'hear' }, 'I heard that {body}.', 'They say {body}.', 'Word on the road is that {body}.', 'A carter told me {body}.', 'From what I hear, {body}.', 'News reached us that {body}.', 'People are saying {body}.'),
  g({ hedge: 'doubt' }, 'They say, though I would not swear to it, that {body}.', 'Rumour has it, and rumour lies, that {body}.', 'I heard a tale that {body}, but who can say?', 'Some drunk at the inn claims {body}. Take it with salt.', 'It might be nothing, but supposedly {body}.', 'If you believe the gossips, {body}.'),
  // Voices
  g({ hedge: ['sure', 'hear'], trait: 'cunning' }, 'I have it on good authority that {body}.', 'Between us: {body}. Do not ask how I know.'),
  g({ hedge: ['sure', 'hear'], trait: 'honest' }, 'I will tell you only what I know: {body}.'),
  g({ hedge: ['hear', 'doubt'], trait: 'superstitious' }, 'The signs pointed to it, and now I hear {body}.', 'I dreamed of it before the news came. {body}.'),
  g({ hedge: ['sure', 'hear'], trait: 'scholarly' }, 'Per the latest dispatches, {body}.', 'According to three independent accounts, {body}.'),
  g({ hedge: ['sure', 'hear'], trait: 'boastful' }, 'I knew it before anyone: {body}.', 'I heard it first, of course. {body}.'),
  g({ hedge: ['sure', 'hear'], trait: 'gruff' }, '{body}. Do not make me repeat it.', '{body}. That is it.'),
  g({ hedge: ['hear', 'doubt'], trait: 'cheerful' }, 'Oh, have you heard? {body}!', 'You will not believe it: {body}!'),
  g({ hedge: ['sure', 'hear'], trait: 'weary' }, 'Another thing: {body}. Sigh.', '{body}. Add it to the pile.'),
  g({ hedge: ['sure', 'hear'], trait: 'devout' }, 'May heaven forgive us: {body}.', 'The shrine\'s keeper whispered it: {body}.'),
  g({ hedge: ['sure', 'hear'], trait: 'kind' }, 'It pains me to say it, but {body}.'),
  g({ hedge: ['sure', 'hear'], trait: 'stern' }, 'Know this: {body}.'),
  g({ hedge: ['sure', 'hear'], trait: 'greedy' }, 'This will move prices, so listen: {body}.'),
  g({ hedge: 'doubt', trait: 'cunning' }, 'It may be a lie, and a clever one, that {body}.'),
  g({ hedge: 'doubt', trait: 'honest' }, 'I have no proof, and I dislike repeating what I cannot prove, but they say {body}.'),
];

const REACTIONS: DlgGroup[] = [
  g({ trait: 'stern' }, 'A bad business, and someone should answer for it.', 'Order must be kept.'),
  g({ trait: 'kind' }, 'I hope everyone is all right.', 'Poor souls. Heaven keep them.'),
  g({ trait: 'greedy' }, 'Prices will move on that, mark my words.', 'There is money in trouble, if you know where to stand.'),
  g({ trait: 'boastful' }, 'I would have handled it differently.', 'Not that it would have gone that way on my watch.'),
  g({ trait: 'weary' }, 'It never stops.', 'One more thing to carry.'),
  g({ trait: 'devout' }, 'I will light a candle.', 'The gods are watching, and we are tested.'),
  g({ trait: 'cunning' }, 'Interesting who benefits, isn\'t it?', 'Ask yourself who gains from that.'),
  g({ trait: 'honest' }, 'That is all I know.', 'I would not say more than I know.'),
  g({ trait: 'gruff' }, 'That is it.', 'Bah.'),
  g({ trait: 'cheerful' }, 'Still, we have weathered worse!', 'Cheer up. It is only the end of the world, again!'),
  g({ trait: 'superstitious' }, 'Bad omens, all of it.', 'I told you the crows were wrong this week.'),
  g({ trait: 'scholarly' }, 'It echoes the old chronicles.', 'History repeats, with fewer footnotes.'),
  g({ rumor: ['fell', 'npcDeath', 'plague', 'famine'] }, 'Heaven rest them.', 'Hard news to carry.'),
  g({ rumor: ['held', 'retaken', 'heartSealed', 'famineEnd', 'plagueEnd', 'blightRecede'] }, 'A small mercy in a hard season.', 'Good news is rare enough to repeat.'),
  g({ rumor: ['war', 'siege', 'captured', 'plundered'] }, 'The strong take what they like. Always.', 'Pray it does not come here.'),
  g({ rumor: ['playerDeed', 'heartSealed'], about: 'self' }, 'You have a name now, {player}, whether you want it or not.', 'Do not let it go to your head, {player}.', 'Word travels faster than you do, {player}.'),
  g({ rumor: 'playerDeed', about: 'other' }, 'Brave. Or foolish. Same thing sometimes.', 'Someone to watch, that one.'),
  g({ rumor: 'legendRise' }, 'The martial world turns, with or without us.'),
  g({ rumor: ['roadBlocked', 'caravan'] }, 'Trade follows the roads, and the roads follow luck.'),
];

export const RUMOR_BODY_FRAGMENTS = buildFragments('rumor', 'body', 'rb', BODIES);
export const RUMOR_HEDGE_FRAGMENTS = buildFragments('rumor', 'hedge', 'rh', HEDGES);
export const RUMOR_CLOSE_FRAGMENTS = buildFragments('rumor', 'close', 'rc', REACTIONS);

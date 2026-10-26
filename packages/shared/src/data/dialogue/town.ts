/** "How is the town?" (topic town) and "Who lives here?" (topic folk). */
import { buildFragments, g, type DlgGroup } from './types';

const TOWN: DlgGroup[] = [
  // Generic
  g({}, 'It is a quiet place, {settlement}. Quiet is a blessing these days.', 'We make do. {settlement} has endured worse than this.', '{settlement} is as it has always been: stubborn.', 'Folk here mind their own business. Mostly.', 'The people of {settlement} are tougher than they look.', 'Every {kind} has its troubles. Ours are just closer to the Blight than most.'),
  // Situations
  g({ state: 'siege' }, 'We are under siege. How do you think the town is? Barely standing.', 'The walls hold, the stores dwindle. That is {settlement} today.', 'Every night I hear the enemy at the walls. Nobody sleeps properly.'),
  g({ state: 'famine' }, 'The granary is near empty. Children first, then the rest of us.', 'We are thin, {player}. Thin and tired. {settlement} will survive, but not gracefully.', 'Soup is mostly water these days, and the water is none too clean.'),
  g({ state: 'plague' }, 'Fever has taken half a street already. We burn the bedding and pray.', 'The sick are kept in the old granary. Nobody visits. Nobody dares.'),
  g({ state: 'festival' }, 'Lively today, as you can see! {settlement} knows how to celebrate.', 'The festival keeps spirits up. Tomorrow\'s problems can wait.'),
  g({ state: 'prosperous' }, 'Never better. The markets are full and the granaries are fat.', 'We have coin in the coffers and children laughing in the streets. Do not jinx it.'),
  g({ state: 'struggling' }, 'Hard times, {player}. The harvest was poor and the roads are dangerous.', 'People are leaving, quietly. The ones who stay do so out of stubbornness or poverty.'),
  g({ state: 'blighted' }, 'The Blight creeps closer every season. We burn what we can and pray for the rest.', 'You can taste it in the water some mornings. Metal and ash.'),
  g({ state: 'fallen' }, 'There is no town, {player}. Just us, and what is left of the walls.'),
  g({ state: 'calm' }, 'Quiet, for now. We try not to speak of it, in case it hears.', 'No siege, no plague, no famine. I am afraid to say it too loudly.'),
  // Roles
  g({ role: 'guard' }, 'Walls are sound, gate is manned, patrols doubled. {settlement} is as safe as I can make it.', 'The town sleeps because someone stays awake. That is the whole of it.'),
  g({ role: 'merchant' }, 'Trade is the lifeblood of {settlement}, and the blood is thin of late.', 'Good for business, if you know where to look. {trade} sells, everything else sits.'),
  g({ role: 'innkeeper' }, 'Everyone says {settlement} is dull. They say it with a full mug in hand.', 'Rooms are full, tables are loud, tempers are short. Business as usual.'),
  g({ role: 'elder' }, '{settlement} has stood for generations. It will stand for more, if we are wise.', 'A town is a family with too many opinions. I mediate.'),
  g({ role: 'smith' }, 'A town runs on iron. Plows, nails, swords. I keep {settlement} running.'),
  g({ role: 'alchemist' }, 'The sick are many and the herbs are few. That is the state of the town.'),
  g({ role: 'physician' }, 'Everybody in {settlement} is a little ill. Some know it, some do not.'),
  g({ role: 'master' }, 'A town is only as strong as the character of the folk in it. Ours are tested often.'),
  g({ role: 'villager' }, 'We get by. Fields to tend, children to feed. It is enough.', 'Neighbours help neighbours here. It is the only way anyone survives.'),
  g({ role: 'legend' }, 'A town is only walls and people. The walls matter less.'),
  g({ role: 'wanderer' }, 'I have seen worse towns. And better. {settlement} is middling, though the stew is good.', 'Folk here look at strangers twice. Not unfriendly, just careful.'),
  // Traits
  g({ trait: 'stern' }, 'Order is maintained. That is all I ask of {settlement}.'),
  g({ trait: 'kind' }, 'People help each other here. It is what keeps us going.'),
  g({ trait: 'greedy' }, 'Coin flows through {settlement} like water, if you know where to dip your cup.'),
  g({ trait: 'boastful' }, 'Best town in the province, thanks to folk like me.'),
  g({ trait: 'weary' }, 'It is the same as yesterday, and the day before. Endless.'),
  g({ trait: 'devout' }, 'The shrine is fuller each week. Fear drives people to prayer.'),
  g({ trait: 'cunning' }, 'Everyone has a secret in {settlement}. I know most of them.'),
  g({ trait: 'honest' }, 'It is a hard place, but it is honest.'),
  g({ trait: 'gruff' }, 'It is a town. Walls, mud, folk. What did you expect?'),
  g({ trait: 'cheerful' }, 'It is wonderful! Well, mostly. Well, it is home.'),
  g({ trait: 'superstitious' }, 'Strange things at night, {player}. I will not say more.'),
  g({ trait: 'scholarly' }, 'The records show {settlement} has endured three sieges and two plagues. We are statistically overdue for peace.'),
  // Slots
  g({}, 'The {controller} keep order here, for better or worse.', 'We pay our dues to the {controller}, and they keep the raiders away. Mostly.'),
  g({}, 'We live by {trade} here. When it prospers, so do we.', 'Prices are {price} just now, if you were wondering.', 'Everything in {settlement} comes back to {trade}, one way or another.'),
  // Seasons
  g({ season: 'spring' }, 'Spring has the whole {kind} in the fields. Even the idle are put to work.'),
  g({ season: 'summer' }, 'The summer heat has everyone short-tempered, but the markets are lively.'),
  g({ season: 'autumn' }, 'Harvest has the town in a good mood and a bad back.'),
  g({ season: 'winter' }, 'Winter makes a small place smaller. Everyone knows everyone\'s business.'),
  // Standing colour
  g({ standing: 'honoured' }, 'It is a better town for having you in it, {player}.'),
  g({ standing: 'despised' }, 'It would be a better town without your trouble, {player}. But you asked.'),
  g({ standing: 'feared' }, 'People walk faster when you pass through. I assume you know why.'),
  // Role x state
  g({ role: 'guard', state: 'siege' }, 'We hold, {player}. That is all I can tell you. We hold.'),
  g({ role: 'merchant', state: 'famine' }, 'Grain is gold at the moment. I shall not insult you with the price.'),
  g({ role: 'innkeeper', state: 'festival' }, 'Best week of the year! Nobody counts their coin during a festival, least of all drunks.'),
  g({ role: 'elder', state: 'plague' }, 'I have sealed off the east lane. It is cruel but necessary.'),
  g({ role: 'physician', state: 'plague' }, 'Keep to the clean side of town and boil your water. That is all I can offer.'),
  g({ role: 'villager', state: 'blighted' }, 'My neighbour\'s well turned bitter last week. Now she hauls water from three streets away.'),
  g({ role: 'smith', state: 'siege' }, 'I have not slept since the siege began. Blades, bolts, rivets. The forge never stops.'),
  g({ role: 'alchemist', state: 'famine' }, 'Hunger breeds sickness. My shelves are full of tonics and my patients are empty of bread.'),
];

const FOLK: DlgGroup[] = [
  g({}, 'About {folk} souls call {settlement} home, give or take whoever left this week.', 'We are not many, {player}, but we know each other very well. Too well, sometimes.', 'Farmers, craftsmen, a few swords. Mostly honest folk, mostly.', 'You will find all sorts in {settlement}. All sorts, if you go looking.'),
  g({}, 'We have {guards} guards on the walls, and they earn every coin.', '{guards} watchmen keep the walls. Not enough, never enough.'),
  g({}, 'The elder here is {elder}. Wise, if slow. Take your questions there.', 'If you want the old stories, {elder} is the one to ask.'),
  g({}, 'If you need iron worked, {smith} at the forge is your person.', '{smith} keeps the forge hot. Blunt, but the best blade-hand for miles.'),
  g({}, '{innkeeper} runs the inn. They hear everything, so watch what you say.', 'You will find {innkeeper} at the inn. Good broth, good ear.'),
  g({}, '{master} teaches here. Prickly, but fair.', 'If you seek instruction, {master} might take you on, if you can stand the discipline.'),
  g({}, '{merchant} keeps the market stall. Fair prices, if you bargain.', 'Need supplies? {merchant} has what you want, for a price.'),
  g({}, '{alchemist} brews the tonics. Do not ask what is in them.', 'Sick or hurt? {alchemist} knows more of herbs than anyone I have met.'),
  g({ trait: 'gruff' }, 'People live here. Ask them yourself.', 'Folk. All kinds. Go and look.'),
  g({ trait: 'cheerful' }, 'Oh, everyone! You will love them. Some of them, at least.', 'Wonderful people! Quarrelsome, but wonderful.'),
  g({ trait: 'cunning' }, 'Who lives here? Who hasn\'t something to hide, you mean. Ask the right person and you will find out.', 'Everyone has a role, {player}, and a price. I will give you names if you give me a reason.'),
  g({ trait: 'honest' }, 'Decent folk, mostly. A thief or two. We know who.'),
  g({ trait: 'scholarly' }, 'The census lists {folk} residents, though the census is a polite fiction.'),
  g({ trait: 'weary' }, 'People. Too many of them, never enough bread.'),
  g({ trait: 'kind' }, 'Good people, all of them, at heart. Some of them hide it well.'),
  g({ trait: 'stern' }, 'A law-abiding community. Mostly. I keep the list of those who are not.'),
  g({ trait: 'superstitious' }, 'Do not ask who lives here at night. Ask who comes back at dawn.'),
  g({ trait: 'devout' }, 'Believers and doubters, same as anywhere. The shrine counts them all in the end.'),
  g({ trait: 'greedy' }, 'Customers, mostly. Some pay on time. Most do not.'),
  g({ trait: 'boastful' }, 'Me! The rest are filler. Ha! Joking. Mostly.'),
  g({ role: 'guard' }, 'I know every face in {settlement}. If one is new, I am told.'),
  g({ role: 'innkeeper' }, 'Everyone drinks here sooner or later. That is how I know them.'),
  g({ role: 'elder' }, 'I have buried most of the people I grew up with. The rest are still here, arguing.'),
  g({ role: 'merchant' }, 'Customers and non-customers. Everyone else is just scenery.'),
  g({ role: 'wanderer' }, 'A mixed lot, as in any place. Friendly to those who earn it.'),
];

export const TOWN_FRAGMENTS = buildFragments('town', 'body', 't', TOWN);
export const FOLK_FRAGMENTS = buildFragments('folk', 'body', 'f', FOLK);

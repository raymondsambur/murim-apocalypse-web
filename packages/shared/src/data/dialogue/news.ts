/**
 * "Any news?" when the NPC knows no rumor worth telling: small talk, weather, prices, harvests, family complaints, boasts,
 * superstitions and sect gossip.
 */
import { buildFragments, g, type DlgGroup } from './types';

const NEWS: DlgGroup[] = [
  g({}, 'Not much news, {player}. The cows are calving, the roof leaks, my neighbour\'s dog has opinions.', 'Nothing worth a coin. Nothing worth a breath, even.', 'You could ask the carters. They always know something. Most of it wrong.', 'Quiet week. I will take quiet.', 'News? I heard a rooster crowed at midnight. Make of that what you will.'),
  g({}, 'The price of {trade} has been {price} lately. That is about all I know.', 'They say {trade} is the thing to hold this season. I say hold nothing, spend it.'),
  g({ weather: 'rain' }, 'The rain has been steady. Roads will be mud for a week.', 'Rain\'s got the river up. The ford is no good for carts.'),
  g({ weather: 'storm' }, 'Lightning struck the old tree last night. Split it right in half.', 'Roof tiles flew off half the street in that storm.'),
  g({ weather: 'snow' }, 'Snow has been piling. The pass might close.', 'A traveller froze on the north road last night. They found him this morning.'),
  g({ weather: 'fog' }, 'The fog is thick as soup. A carter walked into the well yesterday.', 'In fog like this, things are lost. A goat, a cart, a neighbour.'),
  g({ weather: 'clear' }, 'Clear skies: good for drying grain, bad for farmers hoping for rain.', 'Fine weather, so the dust is the news.'),
  g({ weather: 'cloudy' }, 'Clouds all week. The wash will not dry and tempers won\'t cool.'),
  g({ season: 'autumn' }, 'Harvest is going slow; the wheat is thin this year.', 'Apples were plentiful. That is the best news I have.'),
  g({ season: 'spring' }, 'Seed is in the ground. All we need now is rain and luck.', 'First swallows came back this week. Good omen, they say.'),
  g({ season: 'winter' }, 'Firewood is dear this winter. Half the town is burning furniture.', 'The well froze over on the eleventh. First time in years.'),
  g({ season: 'summer' }, 'The well is low. Pray for rain.', 'Heat has the cows dry and the men dry-tempered.'),
  g({ state: 'siege' }, 'News? We are under siege. That is the news.', 'The enemy fires keep us awake all night. That, and the screaming.'),
  g({ state: 'famine' }, 'Nothing but hunger to report.', 'The only news is a loaf of bread, and who has it.'),
  g({ state: 'festival' }, 'Festival! That is the news, {player}. Dancing at dusk.', 'The lanterns arrived from the next village yesterday. Biggest batch we\'ve ever had.'),
  g({ state: 'plague' }, 'The fever took two more last night. We do not talk about it. We just count.', 'Do not touch the east well. That is the whole of my news.'),
  g({ state: 'prosperous' }, 'The market was so full this morning I could not cross it.', 'Folks are building new houses on the east side. Money talks.'),
  g({ state: 'blighted' }, 'A grey patch appeared overnight by the old mill. They burned it. It came back.', 'The animals will not go near the north fence. Make of that what you will.'),
  g({ state: 'fallen' }, 'Our news is ash and silence. Take what comfort you can.'),
  // Sect gossip
  g({}, 'They say the {faction} have been recruiting again. Young ones, mostly.', 'A disciple of the {faction} passed through last week, looking pleased with himself.'),
  g({}, 'Sect disciples brawl over nothing these days. Last week, a bowl of noodles.', 'Rumour is the big sects are quarrelling again. They always are.', 'Two sect masters argued in the market. Neither could remember what about by the end.'),
  // Family
  g({}, 'My wife says I work too much. My mother says I work too little. I listen to neither.', 'My son wants to be a swordsman. I say learn a trade first. He rolls his eyes.', 'My daughter\'s betrothal is off. Long story. Do not ask.', 'My mother-in-law sends her regards and her criticisms.', 'My neighbour is feuding with his brother over a goat. The goat has no opinion.'),
  // Boasts
  g({ trait: 'boastful' }, 'I once drank three jugs of rice wine and won a fight. Might be misremembering the order.', 'I caught a carp this big. Bigger. Heaven\'s truth.', 'Did I tell you about the time I out-walked a horse? I did? Well, here it is again.'),
  // Superstition
  g({ trait: 'superstitious' }, 'A crow sat on the roof this morning. Someone is dying, mark my words.', 'The well rippled with no wind last night. Spirits stir.', 'Do not point at the moon, {player}. It will cut your ear.', 'My candle burned blue last night. Blue! Do you know what that means?'),
  g({ trait: 'devout' }, 'The shrine bell rang by itself last night. We took it as a blessing.', 'The new offering box is already full. Hearts are heavy.'),
  g({ trait: 'scholarly' }, 'I have been cross-referencing three chronicle entries. They disagree on everything but the dates.', 'A fascinating pamphlet arrived from the capital. Fascinating, and largely wrong.'),
  g({ trait: 'cunning' }, 'News costs, {player}. Information is currency. What do you offer?', 'I know three things worth hearing. Choose one to purchase.'),
  g({ trait: 'cheerful' }, 'Oh, there is always news! Where to begin... Well, nothing, but let me talk about it.', 'Have you heard? ... No? Neither have I, but I am sure there is something.'),
  g({ trait: 'gruff' }, 'No news. If there were, I would not tell you.', 'Ask the innkeeper. I do not gossip.'),
  g({ trait: 'weary' }, 'The same news as yesterday. And tomorrow.', 'More bad news than I can carry, and no good news to balance it.'),
  g({ trait: 'greedy' }, 'The only news that matters is the price of rice. It is up, in case you are asking.'),
  g({ trait: 'kind' }, 'A neighbour\'s child took ill but is mending. That is my good news today.'),
  g({ trait: 'honest' }, 'I do not trade in rumour, {player}. If I have not seen it, I will not repeat it.'),
  g({ trait: 'stern' }, 'There was a theft on the east lane. The thief will be found.'),
  // Role-specific
  g({ role: 'guard' }, 'Patrols found tracks near the east road. Bandits, probably. Or boars.', 'Someone left a dead crow on the gatepost. A joke, I hope.', 'We turned away a pedlar with a suspicious cart. Could be nothing. Could be everything.'),
  g({ role: 'innkeeper' }, 'I heard from a carter that the north pass is clear. I heard from another it is not. You choose.', 'Two travellers argued in the corner tonight. Nobody was hurt. The wine suffered.', 'The new serving girl has a voice like a nightingale. Folk come just to hear her.'),
  g({ role: 'merchant' }, 'The caravan is two days late. Bet it is the weather. Or the bandits. Or both.', 'A rival has opened a stall across from mine. I am not worried. Much.'),
  g({ role: 'smith' }, 'Three broken plows this week. The soil is turning hard as stone.', 'Somebody ordered forty arrowheads. Without saying why. Make of that what you will.'),
  g({ role: 'alchemist' }, 'More fever cases this week than last. Keep clean and keep warm.', 'The mugwort is early this year. It is a good sign for tonics.'),
  g({ role: 'master' }, 'Two students quit last week. The rest are showing promise, grudgingly.', 'A new form is circulating. Pretty, impractical. Typical.'),
  g({ role: 'elder' }, 'The council meets next moon. The usual argument about the well tax.', 'A boundary dispute with the next village is dragging into its third season.'),
  g({ role: 'physician' }, 'A child was born with grey hair last night. Nobody says why, everybody knows.', 'Three broken arms this week. A cart overturned on the north road.'),
  g({ role: 'legend' }, 'Nothing new under the sun, {player}. Only newer fools.', 'The young ones talk of glory. The old ones talk of rest. I prefer the latter.'),
  g({ role: 'wanderer' }, 'North road is mud, south road is bandits, east road is quiet. That is my news.', 'I met a peddler on the pass who sold me a map. It was upside down. Or I am.'),
  g({ role: 'disciple' }, 'We hear little in the compound. The masters talk in the hall, and we listen at the door, sweeping.', 'Word is the senior disciples are drilling harder. That means something is coming.', 'The cook says the grain has gone up. The cook is rarely wrong about grain.'),
  g({ role: 'villager' }, 'The hen laid a double yolk yesterday. Take that as you will.', 'Someone stole the washing again. We suspect the goat.'),
  // Standing
  g({ standing: 'honoured' }, 'They are putting your name in the village songs, {player}. It is a tuneless song, but sincere.'),
  g({ standing: 'despised' }, 'The only news is how glad folk will be when you leave.'),
  g({ standing: 'feared' }, 'The talk is all about you, {player}, and none of it is whispered kindly.'),
  // Role x trait
  g({ role: 'innkeeper', trait: 'cheerful' }, 'Oh, you want gossip? Pull up a stool, {player}, I have three days\' worth stored up!'),
  g({ role: 'innkeeper', trait: 'cunning' }, 'News is a trade like any other. What can you offer in exchange, {player}?'),
  g({ role: 'merchant', trait: 'greedy' }, 'The only news worth anything is a price list. I have the latest, for a fee.'),
  g({ role: 'wanderer', trait: 'cheerful' }, 'News from all the roads, {player}! All the news that is fit to say aloud.'),
  g({ role: 'elder', trait: 'scholarly' }, 'The most recent entry in the village record is a dispute over a fence. History is not always grand.'),
  g({ role: 'villager', trait: 'cheerful' }, 'Our pig won a prize! At the fair! First time anyone here has won anything!'),
  g({ role: 'guard', trait: 'gruff' }, 'News is not my job. Keeping you out of trouble is. Do your part.'),
];

export const NEWS_FRAGMENTS = buildFragments('news', 'body', 'n', NEWS);

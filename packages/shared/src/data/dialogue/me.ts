/** "What do you think of me?" Reactions to the player's standing and remembered deeds, in each NPC's voice. */
import { buildFragments, g, type DlgGroup } from './types';

const POSITIVE_DEEDS = ['killedBandits', 'killedHollows', 'savedTown', 'deliveredGoods', 'completedMission', 'duelWon', 'sectFounded', 'rankUp', 'gift', 'purified', 'sealedHeart'] as const;
const NEGATIVE_DEEDS = ['failedMission', 'insult', 'duelLost'] as const;

const ME: DlgGroup[] = [
  // Standing
  g({ standing: 'unknown' }, 'I barely know you, {player}. Ask me again when you have done something worth remembering.', 'A stranger. That is all you are to me for now.', 'No opinion. Give me something to form one with.', 'You have not made a mark here yet, {player}. Not for good, not for ill.'),
  g({ standing: 'noted' }, 'You are known, {player}, if only a little. The name is making rounds.', 'People are watching you, {player}. I cannot say which way they lean.', 'I think you have potential. Whether it turns out good or bad is up to you.'),
  g({ standing: 'welcomed' }, 'A friend, if you will have the word.', 'Welcome, always, {player}. {settlement} speaks well of you.', 'You have earned your place here. Keep earning it.'),
  g({ standing: 'honoured' }, 'You are a hero to this town, {player}. I say it plainly.', 'If it were not for you... well. Many of us would not be here to say it.', 'Honoured. That is the only word that fits.', 'There is a song about you in the market. Not a good one, but it is sincere.'),
  g({ standing: 'feared' }, 'To be honest, {player}, people cross the road when they see you. I would keep my distance too.', 'You are dangerous, and everyone knows it. Do not prove them right.', 'I think you are a storm. Best respected from a distance.'),
  g({ standing: 'despised' }, 'I think you are a stain on {settlement}. There. You asked.', 'You have done nothing but harm here. Do better, or leave.', 'Nobody speaks well of you, {player}. Nobody.'),
  // Rank
  g({}, 'A {rank} fighter. I have seen better, I have seen worse. I have not seen anyone who stopped learning and lived long.', 'You wear the {rank} rank well enough. Now wear it with humility.'),
  // Deeds
  g({ deed: POSITIVE_DEEDS }, 'They talk about you, {player}. How you {deed}. Folk do not forget that.', 'I think of you as the one who {deed}. {ago}, but I still remember.', 'You {deed}. That counts for a great deal around here.', 'I have a very good opinion of you, {player}, after you {deed}.'),
  g({ deed: NEGATIVE_DEEDS }, 'I cannot help remembering how you {deed}. Hard to forgive.', 'I think of the day you {deed}, {ago}. It is not easily forgotten.', 'You {deed}, {player}. We both know it.'),
  g({ deed: 'diedNearby' }, 'I think of you as the one who {deed}. You must be tough to be standing.'),
  g({ deed: 'savedTown', standing: 'honoured' }, 'You stood on our walls, {player}. As far as I am concerned you are one of ours now.'),
  g({ deed: 'sealedHeart' }, 'You sealed a Blight heart. I have no better way to say how I think of you than: with awe.'),
  g({ deed: 'insult', standing: 'despised' }, 'After what you said to us? I think you owe an apology, {player}. Several.'),
  // Traits colour the same question
  g({ trait: 'gruff' }, 'You are all right. For a stranger. Do not let it go to your head.', 'I think you talk too much. Otherwise fine.'),
  g({ trait: 'cheerful' }, 'I like you! You have a good face. That is my official judgement.', 'Wonderful company! Truly. I mean it. Mostly.'),
  g({ trait: 'stern' }, 'Competent, I suppose. Time will tell if you are more.', 'I judge by deeds, not words. You have a few of the first and too many of the second.'),
  g({ trait: 'kind' }, 'I think you are tired, mostly. And kinder than you let on.', 'You carry more than you show. I hope you are looking after yourself.'),
  g({ trait: 'greedy' }, 'I think you have coin or soon will. That is what counts.', 'Your purse and I have a strong mutual interest.'),
  g({ trait: 'boastful' }, 'You remind me of me, back when I was great.', 'A fine fighter, no doubt. Not as fine as me, but who is?'),
  g({ trait: 'weary' }, 'You are young. That is all I can judge, {player}.', 'I think you will learn what tired is, given time.'),
  g({ trait: 'devout' }, 'Your spirit is still unsettled. Pray, it helps.', 'The heavens have their eye on you, {player}. I do not say that lightly.'),
  g({ trait: 'cunning' }, 'You have more going on beneath the surface than you show. I am watching.', 'I think you are clever. I have not yet decided whether to be afraid of it.'),
  g({ trait: 'honest' }, 'You seem straightforward. I like that.', 'I think you mean well. That is more than most can say.'),
  g({ trait: 'superstitious' }, 'Your aura is odd, {player}. Not bad, odd.', 'There is something about you that makes the dogs go quiet. I do not know what to make of it.'),
  g({ trait: 'scholarly' }, 'An interesting case study, {player}. I would need more data.', 'You show the usual symptoms of youth: ambition, haste, and a lack of reading.'),
  // Roles colour it too
  g({ role: 'guard' }, 'I think you are another sword. Question is, whose?', 'I keep an eye on you, {player}. Not personal. I keep an eye on everyone.'),
  g({ role: 'merchant' }, 'I think of you as a potential customer. Do not take it personally.', 'A good customer is a good friend, as far as I am concerned.'),
  g({ role: 'innkeeper' }, 'I think you tip well, which is the opinion that counts.', 'A good guest or a bad one: you tell me.'),
  g({ role: 'master' }, 'You have talent. Whether you have patience is the question.', 'I see potential. I also see impatience. They come together.'),
  g({ role: 'elder' }, 'I have watched many young ones come and go. You, I think, will leave a mark.', 'The village will remember you, {player}, for good or ill. Choose which.'),
  g({ role: 'smith' }, 'I judge folk by how they treat their blades. Yours could use some care.'),
  g({ role: 'alchemist' }, 'I think you are in need of a tonic. Most people are.'),
  g({ role: 'physician' }, 'I think you are overdoing it, {player}. Rest more.'),
  g({ role: 'legend' }, 'You have a spark. Whether it becomes a flame or smoke is up to you.', 'I have met a thousand like you. Three of them were worth the time.'),
  g({ role: 'wanderer' }, 'You are a road-sort. I can smell it. We would get along.'),
  g({ role: 'villager' }, 'You seem all right to me. Though I am a simple person.'),
  // Combined
  g({ role: 'guard', standing: 'honoured' }, 'It would be an honour to stand a watch beside you, {player}.'),
  g({ role: 'guard', standing: 'despised' }, 'One wrong step, {player}, and I will see you out the gate personally.'),
  g({ role: 'merchant', standing: 'honoured' }, 'For you, {player}, I find my scales are always a little generous.'),
  g({ role: 'innkeeper', standing: 'feared' }, 'The staff are afraid of you, {player}. Please be gentle on the furniture.'),
  g({ role: 'elder', standing: 'despised' }, 'I took the council\'s vote on you, {player}. I am sorry to say you did not do well.'),
];

export const ME_FRAGMENTS = buildFragments('me', 'body', 'm', ME);

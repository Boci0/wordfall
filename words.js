// Wordfall word pool — loaded before game.js. Buckets by length 3..11.
// Curated common English words: lowercase a-z only, unique, no proper nouns.
window.WORDFALL_WORDS = [
  // 3
  'arm', 'bag', 'bay', 'bed', 'bee', 'bow', 'box', 'bug', 'bun', 'bus',
  'cap', 'cat', 'cow', 'cup', 'dog', 'ear', 'egg', 'eye', 'fan', 'fog',
  'gap', 'gum', 'hat', 'hen', 'ink', 'jar', 'joy', 'key', 'kid', 'law',
  'log', 'map', 'mop', 'mud', 'nap', 'net', 'oak', 'oil', 'owl', 'pen',
  'pig', 'pot', 'ram', 'rug', 'run', 'sit', 'sky', 'sun', 'tap', 'tea',
  'toy', 'van', 'wax', 'web', 'yak', 'zip',
  // 4
  'able', 'acid', 'army', 'aunt', 'baby', 'back', 'bake', 'ball', 'band', 'bank',
  'barn', 'base', 'bath', 'bead', 'beam', 'bean', 'bear', 'beat', 'bell', 'belt',
  'bike', 'bird', 'bite', 'blue', 'boat', 'body', 'boil', 'bold', 'bolt', 'bone',
  'book', 'boot', 'bowl', 'brew', 'bulb', 'bulk', 'burn', 'bush', 'cake', 'calf',
  'call', 'calm', 'camp', 'cane', 'card', 'care', 'cart', 'cash', 'cave', 'cell',
  'chat', 'chef', 'chin', 'chip', 'city', 'clam', 'clay', 'clip', 'club', 'coal',
  'coat', 'code', 'coin', 'cold', 'cone', 'cook', 'cool', 'cork', 'corn', 'cost',
  'crab', 'crew', 'crop', 'crow',
  // 5
  'about', 'above', 'actor', 'acute', 'admit', 'adopt', 'adult', 'after', 'again', 'agent',
  'agree', 'ahead', 'alarm', 'album', 'alert', 'alien', 'alive', 'allow', 'alone', 'along',
  'alter', 'amber', 'ample', 'angel', 'anger', 'angle', 'angry', 'ankle', 'apart', 'apple',
  'apply', 'arena', 'argue', 'arise', 'armor', 'aroma', 'array', 'arrow', 'aside', 'asset',
  'atlas', 'attic', 'audio', 'audit', 'avoid', 'awake', 'award', 'aware', 'awful', 'bacon',
  'badge', 'badly', 'basic', 'basil', 'basin', 'basis', 'batch', 'beach', 'beard', 'beast',
  'begin', 'below', 'bench', 'berry', 'birth', 'black', 'blade', 'blame', 'blank', 'blast',
  'blaze', 'blend', 'bless', 'blind',
  // 6
  'absent', 'absurd', 'accept', 'access', 'accuse', 'across', 'action', 'active', 'actual', 'adjust',
  'admire', 'advice', 'advise', 'afford', 'afraid', 'agency', 'agenda', 'almost', 'always', 'amount',
  'animal', 'annual', 'answer', 'anyone', 'appeal', 'appear', 'around', 'arrest', 'arrive', 'artist',
  'aspect', 'assess', 'assign', 'assist', 'assume', 'assure', 'attach', 'attack', 'attend', 'author',
  'autumn', 'avenue', 'backup', 'bakery', 'ballot', 'banana', 'banker', 'banner', 'barrel', 'basket',
  'battle', 'beauty', 'become', 'before', 'behalf', 'behave', 'behind', 'belief', 'belong', 'beside',
  'better', 'beyond', 'binary', 'bishop', 'bitter', 'border', 'borrow', 'bottle', 'bottom', 'bounce',
  // 7
  'abandon', 'ability', 'absence', 'academy', 'account', 'achieve', 'acquire', 'address', 'advance', 'against',
  'airline', 'airport', 'alcohol', 'algebra', 'already', 'amateur', 'amazing', 'ancient', 'another', 'anxiety',
  'anybody', 'appoint', 'approve', 'arrival', 'article', 'athlete', 'attempt', 'attract', 'auction', 'average',
  'awkward', 'balance', 'balloon', 'banquet', 'barrier', 'battery', 'because', 'bedside', 'beneath', 'benefit',
  'between', 'bicycle', 'biology', 'blanket', 'blunder', 'bracket', 'breathe', 'brewery', 'brother', 'buffalo',
  'builder', 'cabinet', 'calorie', 'capital', 'captain', 'caption', 'capture', 'caravan', 'careful',
  // 8
  'absolute', 'abstract', 'accurate', 'activity', 'addition', 'aircraft', 'alphabet', 'announce', 'anything', 'apparent',
  'approach', 'argument', 'assembly', 'athletic', 'attorney', 'audience', 'backbone', 'bacteria', 'baseball', 'basement',
  'bathroom', 'birthday', 'boundary', 'building', 'bulletin', 'business', 'calendar', 'campaign', 'capacity', 'ceremony',
  'champion', 'circular', 'clothing', 'complete', 'computer', 'concrete', 'conflict', 'congress', 'consider', 'constant',
  'continue', 'contract', 'coverage', 'creation', 'creative', 'creature', 'critical', 'cultural', 'customer', 'daughter',
  // 9
  'adventure', 'afternoon', 'agreement', 'ambulance', 'animation', 'apartment', 'architect', 'assistant', 'astronomy', 'attention',
  'authority', 'available', 'awareness', 'beautiful', 'beginning', 'breakfast', 'brilliant', 'candidate', 'cardboard', 'carpenter',
  'celebrate', 'challenge', 'character', 'chemistry', 'chocolate', 'cigarette', 'classical', 'collector', 'committee', 'community',
  'complaint', 'condition', 'conductor', 'container', 'continent', 'criticism', 'curiosity', 'democracy',
  // 10
  'accountant', 'appreciate', 'beneficial', 'capability', 'commercial', 'comparison', 'conclusion', 'conference', 'confidence', 'consistent',
  'convenient', 'difference', 'enterprise', 'everything', 'experiment', 'foundation', 'generation', 'government', 'helicopter', 'illustrate',
  'impressive', 'incredible', 'ingredient', 'instrument',
  // 11
  'achievement', 'arrangement', 'comfortable', 'description', 'destination', 'environment', 'fingerprint', 'independent', 'information', 'instruction',
  'investigate', 'opportunity', 'preparation', 'temperature'
];

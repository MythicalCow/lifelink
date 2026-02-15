#include "ai_triage.h"

#include <ctype.h>
#include <string.h>

#include "ai_tree_generated.h"

namespace {
constexpr int kFeatureDim = 82;
constexpr int kStructureDim = 8;
constexpr int kNgramBins = 64;
constexpr int kNgramStart = 18;

const char* const kLocCues[] = {"near", "at", "by", "behind", "next to", "coords", "gps", "location"};
const char* const kPlaceTokens[] = {"library", "bridge", "camp", "market", "hospital", "school"};
const char* const kTimeWords[] = {"now", "asap", "urgent", "tonight", "immediately", "right away", "soon", "quick"};
const char* const kLocWords[] = {
    "at", "near", "behind", "by", "next to", "around", "in", "gps", "coords", "coordinate", "location",
    "library", "bridge", "camp", "market", "hospital", "school"};

const char* const kBucketMedic[] = {"medic", "doctor", "injured", "bleed", "bleeding", "unconscious", "hurt", "wounded", "ambulance", "pain", "trauma", "emergency", "critical", "wound", "wounds", "fracture", "broken bone", "stabilize", "first aid", "paramedic", "nurse", "hospital", "bleeding out", "hemorrhage", "concussion", "laceration", "stitches", "cardiac", "cpr", "resuscitate", "collapse", "unresponsive", "casualty", "casualties", "not talking"};
const char* const kBucketWater[] = {"water", "thirsty", "dehydration", "bottle", "well", "hydration", "drink", "drinking", "dry", "clean water", "potable", "running out of water", "no water", "water supply", "thirst", "parched", "reservoir", "purify", "filter", "cistern", "faucet", "running water"};
const char* const kBucketFood[] = {"food", "hungry", "ration", "rice", "bread", "meal", "starving", "rations", "supplies", "feed", "feeding", "malnutrition", "famine", "provisions", "groceries", "eat", "eating", "kitchen", "cook", "cooking", "starvation", "no food", "out of food", "need food", "run out"};
const char* const kBucketShelter[] = {"shelter", "tent", "roof", "cold", "sleep", "blanket", "safehouse", "housing", "warm", "warmth", "indoors", "building", "refuge", "camp", "campsite", "bed", "sleeping", "freezing", "hypothermia", "frostbite", "nowhere to stay", "homeless", "evicted"};
const char* const kBucketDanger[] = {"gun", "shooting", "shots", "explosion", "attack", "fire", "bomb", "sniper", "danger", "gunfire", "armed", "weapon", "weapons", "violence", "hostile", "strike", "striking", "explosive", "blast", "IED", "grenade", "ambush", "raid", "invasion", "threat", "threatened"};
const char* const kBucketEvac[] = {"evacuate", "leave", "run", "escape", "exit", "safe route", "move out", "relocate", "evacuation", "evac", "get out", "flee", "fleeing", "exodus", "withdraw", "pull out", "route out", "safe path", "clear path", "extract", "extraction", "rescue", "evacuees"};
const char* const kBucketInfo[] = {"where", "when", "status", "update", "check-in", "anyone", "need info", "what's up", "whats up", "news", "situation", "report", "intel", "intelligence", "briefing", "sitrep", "location of", "anyone know", "heard", "rumor", "confirmed", "unconfirmed", "latest", "current"};
const char* const kBucketDisaster[] = {"flood", "flooding", "flooded", "water everywhere", "earthquake", "quake", "tsunami", "landslide", "hurricane", "tornado", "storm", "disaster", "natural disaster", "wildfire", "mudslide", "avalanche", "cyclone", "typhoon", "drought", "blizzard", "hail", "building collapse", "collapsed", "washed away", "inundated", "submerged", "trapped"};
const char* const kBucketSickness[] = {"sick", "illness", "ill", "fever", "cough", "virus", "disease", "vomiting", "diarrhea", "symptoms", "infection", "infected", "contagious", "outbreak", "epidemic", "pandemic", "nausea", "dizzy", "weak", "can't breathe", "shortness of breath", "chest pain", "allergic", "allergy", "reaction", "poisoning", "food poisoning", "dehydrated"};
const char* const kBucketChat[] = {"lol", "ok", "okay", "thanks", "thank you", "see you", "brb", "hi", "hello", "good", "nice", "hey", "yeah", "yep", "nope", "sure", "cool", "great", "fine", "bye", "later", "got it", "understood", "copy", "roger", "check", "alright", "whatever", "k"};

struct BucketDef {
  const char* const* words;
  size_t count;
};

const BucketDef kBuckets[] = {
    {kBucketMedic, sizeof(kBucketMedic) / sizeof(kBucketMedic[0])},
    {kBucketWater, sizeof(kBucketWater) / sizeof(kBucketWater[0])},
    {kBucketFood, sizeof(kBucketFood) / sizeof(kBucketFood[0])},
    {kBucketShelter, sizeof(kBucketShelter) / sizeof(kBucketShelter[0])},
    {kBucketDanger, sizeof(kBucketDanger) / sizeof(kBucketDanger[0])},
    {kBucketEvac, sizeof(kBucketEvac) / sizeof(kBucketEvac[0])},
    {kBucketInfo, sizeof(kBucketInfo) / sizeof(kBucketInfo[0])},
    {kBucketDisaster, sizeof(kBucketDisaster) / sizeof(kBucketDisaster[0])},
    {kBucketSickness, sizeof(kBucketSickness) / sizeof(kBucketSickness[0])},
    {kBucketChat, sizeof(kBucketChat) / sizeof(kBucketChat[0])},
};

bool containsAnySubstring(const char* haystack, const char* const* words, size_t count) {
  for (size_t i = 0; i < count; ++i) {
    if (strstr(haystack, words[i]) != nullptr) {
      return true;
    }
  }
  return false;
}

bool containsToken(const char* norm, const char* token) {
  size_t token_len = strlen(token);
  if (token_len == 0) return false;
  const char* p = norm;
  while (*p) {
    while (*p == ' ') ++p;
    if (!*p) break;
    const char* end = strchr(p, ' ');
    if (!end) end = p + strlen(p);
    size_t len = static_cast<size_t>(end - p);
    if (len == token_len && strncmp(p, token, token_len) == 0) {
      return true;
    }
    p = end;
  }
  return false;
}

void normalizeText(const char* in, char* out, size_t out_len) {
  size_t j = 0;
  bool prev_space = true;
  for (size_t i = 0; in[i] != '\0' && j + 1 < out_len; ++i) {
    unsigned char c = static_cast<unsigned char>(in[i]);
    if (isalnum(c)) {
      out[j++] = static_cast<char>(tolower(c));
      prev_space = false;
    } else if (!prev_space) {
      out[j++] = ' ';
      prev_space = true;
    }
  }
  if (j > 0 && out[j - 1] == ' ') --j;
  out[j] = '\0';
}

uint32_t fnv1a32(const char* s, size_t n) {
  uint32_t h = 0x811C9DC5u;
  for (size_t i = 0; i < n; ++i) {
    h ^= static_cast<uint8_t>(s[i]);
    h *= 0x01000193u;
  }
  return h;
}

int extractCount(const char* norm) {
  for (size_t i = 0; norm[i] != '\0'; ++i) {
    if (isdigit(static_cast<unsigned char>(norm[i]))) {
      int v = norm[i] - '0';
      if (isdigit(static_cast<unsigned char>(norm[i + 1]))) {
        v = v * 10 + (norm[i + 1] - '0');
      }
      return v;
    }
  }
  return 0;
}

const char* extractLocationToken(const char* norm) {
  for (size_t i = 0; i < sizeof(kPlaceTokens) / sizeof(kPlaceTokens[0]); ++i) {
    if (strstr(norm, kPlaceTokens[i]) != nullptr) {
      return kPlaceTokens[i];
    }
  }
  return "unknown";
}

bool needsLocation(const char* norm) {
  return !containsAnySubstring(norm, kLocCues, sizeof(kLocCues) / sizeof(kLocCues[0]));
}

bool needsConfirmation(const char* intent) {
  return strcmp(intent, "DANGER") == 0 || strcmp(intent, "EVAC") == 0 || strcmp(intent, "DISASTER") == 0;
}

void buildVector(const String& text, float* x) {
  for (int i = 0; i < kFeatureDim; ++i) x[i] = 0.0f;

  char raw[160];
  text.substring(0, sizeof(raw) - 1).toCharArray(raw, sizeof(raw));
  char norm[160];
  normalizeText(raw, norm, sizeof(norm));

  int len_chars = static_cast<int>(strlen(norm));
  int len_words = 0;
  for (size_t i = 0; norm[i] != '\0'; ++i) {
    if ((i == 0 || norm[i - 1] == ' ') && norm[i] != ' ') ++len_words;
  }
  int num_digits = 0;
  int letters = 0;
  int caps = 0;
  bool has_excl = false;
  bool has_q = false;
  for (size_t i = 0; raw[i] != '\0'; ++i) {
    unsigned char c = static_cast<unsigned char>(raw[i]);
    if (isdigit(c)) ++num_digits;
    if (c == '!') has_excl = true;
    if (c == '?') has_q = true;
    if (isalpha(c)) {
      ++letters;
      if (isupper(c)) ++caps;
    }
  }
  float caps_ratio = (letters > 0) ? (static_cast<float>(caps) / static_cast<float>(letters)) : 0.0f;

  bool has_time = false;
  for (size_t i = 0; i < sizeof(kTimeWords) / sizeof(kTimeWords[0]); ++i) {
    if (containsToken(norm, kTimeWords[i])) {
      has_time = true;
      break;
    }
  }
  bool has_loc = containsAnySubstring(norm, kLocWords, sizeof(kLocWords) / sizeof(kLocWords[0]));

  x[0] = min(len_words, 50) / 50.0f;
  x[1] = min(len_chars, 200) / 200.0f;
  x[2] = min(num_digits, 20) / 20.0f;
  x[3] = has_excl ? 1.0f : 0.0f;
  x[4] = has_q ? 1.0f : 0.0f;
  x[5] = min(caps_ratio * 10.0f, 1.0f);
  x[6] = has_time ? 1.0f : 0.0f;
  x[7] = has_loc ? 1.0f : 0.0f;

  for (size_t bi = 0; bi < sizeof(kBuckets) / sizeof(kBuckets[0]); ++bi) {
    int score = 0;
    for (size_t wi = 0; wi < kBuckets[bi].count; ++wi) {
      if (strstr(norm, kBuckets[bi].words[wi]) != nullptr) {
        ++score;
      }
    }
    x[kStructureDim + static_cast<int>(bi)] = static_cast<float>(score);
  }

  char padded[170];
  snprintf(padded, sizeof(padded), " %s ", norm);
  size_t p_len = strlen(padded);
  for (size_t i = 0; i + 4 <= p_len; ++i) {
    char gram[5];
    memcpy(gram, &padded[i], 4);
    gram[4] = '\0';
    bool only_space = true;
    for (int j = 0; j < 4; ++j) {
      if (gram[j] != ' ') {
        only_space = false;
        break;
      }
    }
    if (only_space) continue;
    uint32_t b = fnv1a32(gram, 4) % kNgramBins;
    x[kNgramStart + static_cast<int>(b)] += 1.0f;
  }
  for (int i = kNgramStart; i < kFeatureDim; ++i) {
    if (x[i] > 15.0f) x[i] = 15.0f;
    x[i] /= 15.0f;
  }
}
}  // namespace

TriageOutput runTriage(const String& text) {
  float x[kFeatureDim];
  buildVector(text, x);

  const int8_t vital_idx = vital_predict(x);
  const bool is_vital = vital_idx == 1;
  if (!is_vital) {
    return {false, text, "CHAT", 0, 0, 0, "unknown"};
  }

  const int8_t intent_idx = intent_predict(x);
  const int8_t urgency_idx = urgency_predict(x);

  const char* intent = (intent_idx >= 0 && intent_idx < INTENT_CLASS_COUNT) ? INTENT_CLASSES[intent_idx] : "INFO";
  uint8_t urgency = (urgency_idx < 0) ? 2 : static_cast<uint8_t>(urgency_idx);
  if (urgency > 3) urgency = 3;

  char norm[160];
  char raw[160];
  text.substring(0, sizeof(raw) - 1).toCharArray(raw, sizeof(raw));
  normalizeText(raw, norm, sizeof(norm));

  const bool need_loc = needsLocation(norm);
  const bool need_confirm = needsConfirmation(intent);
  const uint8_t flags = static_cast<uint8_t>((need_loc ? 1 : 0) | ((need_confirm ? 1 : 0) << 1));
  const uint8_t count = static_cast<uint8_t>(extractCount(norm));
  const char* loc = extractLocationToken(norm);

  char payload[96];
  snprintf(payload, sizeof(payload), "%s|U%u|F%u|N%u|L%s", intent, urgency, flags, count, loc);

  TriageOutput out{};
  out.is_vital = true;
  out.wire_payload = String(payload);
  out.intent = String(intent);
  out.urgency = urgency;
  out.flags = flags;
  out.count = count;
  out.location = String(loc);
  return out;
}


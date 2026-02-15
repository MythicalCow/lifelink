#pragma once

#include <Arduino.h>

struct TriageOutput {
  bool is_vital;
  String wire_payload;
  String intent;
  uint8_t urgency;
  uint8_t flags;
  uint8_t count;
  String location;
};

TriageOutput runTriage(const String& text);


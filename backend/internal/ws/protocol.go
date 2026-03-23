package ws

import (
	"encoding/json"
)

// Message is the WebSocket JSON envelope: {"e": "eventName", "d": {...}}
type Message struct {
	Event string          `json:"e"`
	Data  json.RawMessage `json:"d"`
}

// EncodeMessage JSON-marshals a Message from event and data.
func EncodeMessage(event string, data interface{}) ([]byte, error) {
	var raw json.RawMessage
	if data != nil {
		b, err := json.Marshal(data)
		if err != nil {
			return nil, err
		}
		raw = b
	}
	return json.Marshal(Message{Event: event, Data: raw})
}

// DecodeMessage JSON-unmarshals raw bytes into a Message.
func DecodeMessage(raw []byte) (*Message, error) {
	var msg Message
	if err := json.Unmarshal(raw, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}

// ParseData unmarshals msg.Data into target.
func ParseData(msg *Message, target interface{}) error {
	if msg == nil || len(msg.Data) == 0 {
		return nil
	}
	return json.Unmarshal(msg.Data, target)
}

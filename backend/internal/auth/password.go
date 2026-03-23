package auth

import (
	"golang.org/x/crypto/bcrypt"
)

// HashPassword returns a bcrypt hash of the password with cost 10.
func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

// ComparePassword returns true if the password matches the hash.
func ComparePassword(hash, password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

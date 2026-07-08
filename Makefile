.PHONY: build clean test

BINARY := app/wireguard-ui
SRC_DIR := app/server
BUILD_DIR := build
FPK := fn-wireguard.fpk
FPK_VERSION := fn-wireguard_1.0.0_x86.fpk

test:
	cd $(SRC_DIR) && go test ./... -v

build: $(BINARY)
	@mkdir -p $(BUILD_DIR)
	fnpack build -d .
	@mv $(FPK) $(BUILD_DIR)/$(FPK_VERSION)
	@echo "→ $(BUILD_DIR)/$(FPK_VERSION)"

$(BINARY):
	cd $(SRC_DIR) && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o ../../$(BINARY) .

clean:
	rm -f $(BINARY)
	rm -rf $(BUILD_DIR)
	rm -f $(FPK)

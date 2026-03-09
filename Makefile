SHELL := /bin/bash

BUMP ?= patch
VERSION ?=
DRAFT ?= 0

.PHONY: build release release-check

build:
	npm run build

release:
	npm run release -- $(if $(VERSION),$(VERSION),$(BUMP)) $(if $(filter 1 true yes,$(DRAFT)),--draft,)

release-check:
	npm run release:check

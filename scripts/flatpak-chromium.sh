#!/bin/sh
exec flatpak run --command=chromium org.chromium.Chromium "$@"

#!/usr/bin/env bash

mkdir -p build build/assets
browserify *.js > build/bundle.js
cp -r assets/* build/assets/

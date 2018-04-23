#!/usr/bin/env bash

browserify *.js > build/bundle.js
cp -r assets/ build/assets

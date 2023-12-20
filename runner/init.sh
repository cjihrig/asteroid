#!/bin/sh
wget -q -O /tmp/deployment.tar.gz $ASTEROID_DEPLOYMENT_PACKAGE_URL
tar -xzf /tmp/deployment.tar.gz -C /src --strip-components=2
node /runner/runner.js

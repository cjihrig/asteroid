FROM rust:1.74.1
WORKDIR /app
RUN cargo install sqlx-cli
# TODO(cjihrig): Ignore the Dockerfile
COPY . ./migrations
ENTRYPOINT ["sqlx", "migrate", "run"]

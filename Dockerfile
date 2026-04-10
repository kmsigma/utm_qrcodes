# syntax=docker/dockerfile:1

# ── Build stage ─────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:8.0-alpine AS build
WORKDIR /src

COPY qrcodes.csproj ./
RUN dotnet restore qrcodes.csproj

COPY qrcodes.cs ./
RUN dotnet publish qrcodes.csproj \
    --configuration Release \
    --no-restore \
    --output /app/publish \
    -p:UseAppHost=false

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:8.0-alpine AS final
WORKDIR /app

# Drop root: run as a non-privileged user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

COPY --from=build /app/publish .
COPY wwwroot ./wwwroot

ENV ASPNETCORE_URLS=http://+:4278
ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 4278

ENTRYPOINT ["dotnet", "qrcodes.dll"]

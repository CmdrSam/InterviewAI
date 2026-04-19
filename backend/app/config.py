from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    redis_url: str | None = None
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"


settings = Settings()

import { SEARCH_LIMIT_MAX } from './config.js';

export const databaseUserMethods = {
  /**
   * Get user by API token.
   * Returns user with their config if token is valid, null otherwise.
   */
  async getUserByToken(token) {
    if (!token) return null;

    const result = await this.pool.query(`
      SELECT
        u.id, u.google_id, u.email, u.name, u.picture_url,
        u.created_at, u.last_login_at,
        t.id as token_id,
        uc.key as config_key, uc.value as config_value
      FROM user_tokens t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN user_config uc ON uc.user_id = u.id
      WHERE t.token = $1
        AND t.revoked_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at > NOW())
    `, [token]);

    if (result.rows.length === 0) return null;

    const firstRow = result.rows[0];
    const user = {
      id: firstRow.id,
      google_id: firstRow.google_id,
      email: firstRow.email,
      name: firstRow.name,
      picture_url: firstRow.picture_url,
      created_at: firstRow.created_at,
      last_login_at: firstRow.last_login_at,
      config: {},
    };

    for (const row of result.rows) {
      if (row.config_key) {
        user.config[row.config_key] = row.config_value;
      }
    }

    this.pool.query(`
      UPDATE user_tokens SET last_used_at = NOW() WHERE id = $1
    `, [firstRow.token_id]).catch(() => {});

    return user;
  },

  /**
   * Get or create user by Google OAuth info.
   * Auto-provisions new users and updates existing ones on each login.
   */
  async upsertGoogleUser(googleId, email, name, pictureUrl) {
    let result;
    try {
      result = await this.pool.query(`
        INSERT INTO users (google_id, email, name, picture_url, last_login_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (google_id) DO UPDATE SET
          email = EXCLUDED.email,
          name = EXCLUDED.name,
          picture_url = EXCLUDED.picture_url,
          last_login_at = NOW()
        RETURNING id, google_id, email, name, picture_url, created_at, last_login_at
      `, [googleId, email, name, pictureUrl]);
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'users_email_key') {
        result = await this.pool.query(`
          UPDATE users SET
            google_id = $1,
            name = $3,
            picture_url = $4,
            last_login_at = NOW()
          WHERE email = $2
          RETURNING id, google_id, email, name, picture_url, created_at, last_login_at
        `, [googleId, email, name, pictureUrl]);
      } else {
        throw err;
      }
    }

    const user = result.rows[0];
    const configResult = await this.pool.query(
      'SELECT key, value FROM user_config WHERE user_id = $1',
      [user.id]
    );
    user.config = {};
    for (const row of configResult.rows) {
      user.config[row.key] = row.value;
    }

    return user;
  },

  async createUserToken(userId, tokenName = null) {
    const crypto = await import('crypto');
    const token = crypto.randomBytes(32).toString('hex');

    const result = await this.pool.query(`
      INSERT INTO user_tokens (user_id, token, name)
      VALUES ($1, $2, $3)
      RETURNING id, token, name, created_at
    `, [userId, token, tokenName]);

    return result.rows[0];
  },

  async getUserConfig(userId, key) {
    const result = await this.pool.query(`
      SELECT value FROM user_config WHERE user_id = $1 AND key = $2
    `, [userId, key]);

    return result.rows.length > 0 ? result.rows[0].value : null;
  },

  async setUserConfig(userId, key, value) {
    await this.pool.query(`
      INSERT INTO user_config (user_id, key, value)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value
    `, [userId, key, value]);
  },

  async userHasConfig(userId, key, expectedValue = null) {
    const value = await this.getUserConfig(userId, key);
    if (expectedValue === null) {
      return value !== null;
    }
    return value === expectedValue;
  },

  async listUserTokens(userId) {
    const result = await this.pool.query(`
      SELECT id, name, created_at, expires_at, last_used_at,
             CASE WHEN revoked_at IS NOT NULL THEN 'revoked'
                  WHEN expires_at IS NOT NULL AND expires_at < NOW() THEN 'expired'
                  ELSE 'active' END as status
      FROM user_tokens
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 100
    `, [userId]);

    return result.rows;
  },

  async revokeToken(tokenId, userId) {
    await this.pool.query(`
      UPDATE user_tokens SET revoked_at = NOW()
      WHERE id = $1 AND user_id = $2
    `, [tokenId, userId]);
  },

  async addFavorite(userId, osmId, notes = null) {
    const poiCheck = await this.pool.query(
      'SELECT 1 FROM osm_pois WHERE osm_id = $1',
      [osmId]
    );
    if (poiCheck.rows.length === 0) {
      return false;
    }

    await this.pool.query(`
      INSERT INTO user_favorites (user_id, poi_osm_id, notes)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, poi_osm_id) DO UPDATE SET notes = EXCLUDED.notes
    `, [userId, osmId, notes]);

    return true;
  },

  async removeFavorite(userId, osmId) {
    const result = await this.pool.query(`
      DELETE FROM user_favorites
      WHERE user_id = $1 AND poi_osm_id = $2
    `, [userId, osmId]);

    return result.rowCount > 0;
  },

  async isFavorite(userId, osmId) {
    const result = await this.pool.query(`
      SELECT 1 FROM user_favorites WHERE user_id = $1 AND poi_osm_id = $2
    `, [userId, osmId]);

    return result.rows.length > 0;
  },

  async listFavorites(userId, options = {}) {
    const {
      cityName,
      countryCode,
      state,
      latitude,
      longitude,
      radiusKm = 50,
      poiTypes,
      limit = 100,
    } = options;

    const typeDesc = poiTypes ? poiTypes.join(',') : 'all';
    console.error(`[listFavorites] userId=${userId}, city=${cityName}, country=${countryCode}, state=${state}, lat=${latitude}, lon=${longitude}, radius=${radiusKm}km, types=${typeDesc}, limit=${limit}`);

    const conditions = ['f.user_id = $1'];
    const params = [userId];
    let paramIndex = 2;

    if (latitude !== undefined && longitude !== undefined) {
      conditions.push(`ST_DWithin(
        e.osm_location::geography,
        ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)::geography,
        $${paramIndex + 2}
      )`);
      params.push(longitude, latitude, radiusKm * 1000);
      paramIndex += 3;
    } else if (cityName && countryCode) {
      const escapedCity = cityName.replace(/[%_\\]/g, '\\$&');
      conditions.push(`e.city ILIKE $${paramIndex} AND e.country_code = $${paramIndex + 1}`);
      params.push(`%${escapedCity}%`, countryCode);
      paramIndex += 2;

      if (state) {
        conditions.push(`EXISTS (
          SELECT 1 FROM geonames_cities gc
          JOIN geonames_admin1_codes a1 ON gc.country_code = a1.country_code AND gc.admin1_code = a1.admin1_code
          WHERE gc.geoname_id = e.city_geoname_id
          AND (a1.admin1_code = $${paramIndex} OR a1.name ILIKE $${paramIndex})
        )`);
        params.push(state);
        paramIndex += 1;
      }
    } else if (countryCode) {
      conditions.push(`e.country_code = $${paramIndex}`);
      params.push(countryCode);
      paramIndex += 1;
    }

    if (poiTypes && poiTypes.length > 0) {
      conditions.push(`e.poi_type = ANY($${paramIndex})`);
      params.push(poiTypes);
      paramIndex += 1;
    }

    let selectFields = `
      TRUE as is_favorite,
      f.created_at as favorite_since,
      f.notes as favorite_notes,
      e.*
    `;

    if (latitude !== undefined && longitude !== undefined) {
      selectFields += `,
        ROUND(ST_Distance(
          e.osm_location::geography,
          ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
        )::numeric, 0) as distance_meters
      `;
    }

    const orderBy = latitude !== undefined && longitude !== undefined
      ? 'ORDER BY distance_meters ASC'
      : 'ORDER BY f.created_at DESC';

    const query = `
      SELECT ${selectFields}
      FROM user_favorites f
      JOIN enriched_pois e ON f.poi_osm_id = e.osm_id
      WHERE ${conditions.join(' AND ')}
      ${orderBy}
      LIMIT $${paramIndex}
    `;
    params.push(Math.min(limit, SEARCH_LIMIT_MAX));

    const result = await this.pool.query(query, params);
    return result.rows;
  },

  async updateFavoriteNotes(userId, osmId, notes = null) {
    const result = await this.pool.query(`
      UPDATE user_favorites
      SET notes = $3
      WHERE user_id = $1 AND poi_osm_id = $2
    `, [userId, osmId, notes]);

    return result.rowCount > 0;
  },
};

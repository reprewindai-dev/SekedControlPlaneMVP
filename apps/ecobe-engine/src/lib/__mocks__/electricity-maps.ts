export const electricityMaps = {
  getCarbonIntensity: jest.fn().mockImplementation(async (zone: string) => {
    const intensities: Record<string, number> = {
      'US-CAL-CISO': 180,
      FR: 58,
      DE: 320,
      GB: 240,
      SE: 45,
      NO: 28,
    }

    return {
      zone,
      carbonIntensity: intensities[zone] ?? 200,
      datetime: new Date().toISOString(),
    }
  }),
  getForecast: jest.fn().mockResolvedValue([]),
}

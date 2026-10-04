// The app logs freely (and refusals log errors on purpose); a failing check says what failed.
for (const k of ['log', 'info', 'warn', 'error', 'debug']) jest.spyOn(console, k).mockImplementation(() => {});

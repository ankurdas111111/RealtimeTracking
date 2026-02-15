/**
 * Country dial codes with mobile number length validation.
 * Each entry: [dialCode, countryISO, countryName, flag, minDigits, maxDigits]
 * minDigits/maxDigits = local number length (without country code).
 * Shared between client (browser) and server (Node.js via require).
 */
(function(root) {
  var COUNTRY_CODES = [
    ["+93","AF","Afghanistan","\uD83C\uDDE6\uD83C\uDDEB",9,9],
    ["+355","AL","Albania","\uD83C\uDDE6\uD83C\uDDF1",8,9],
    ["+213","DZ","Algeria","\uD83C\uDDE9\uD83C\uDDFF",9,9],
    ["+376","AD","Andorra","\uD83C\uDDE6\uD83C\uDDE9",6,9],
    ["+244","AO","Angola","\uD83C\uDDE6\uD83C\uDDF4",9,9],
    ["+54","AR","Argentina","\uD83C\uDDE6\uD83C\uDDF7",10,11],
    ["+374","AM","Armenia","\uD83C\uDDE6\uD83C\uDDF2",8,8],
    ["+61","AU","Australia","\uD83C\uDDE6\uD83C\uDDFA",9,9],
    ["+43","AT","Austria","\uD83C\uDDE6\uD83C\uDDF9",4,13],
    ["+994","AZ","Azerbaijan","\uD83C\uDDE6\uD83C\uDDFF",9,9],
    ["+973","BH","Bahrain","\uD83C\uDDE7\uD83C\uDDED",8,8],
    ["+880","BD","Bangladesh","\uD83C\uDDE7\uD83C\uDDE9",10,10],
    ["+375","BY","Belarus","\uD83C\uDDE7\uD83C\uDDFE",9,10],
    ["+32","BE","Belgium","\uD83C\uDDE7\uD83C\uDDEA",9,9],
    ["+501","BZ","Belize","\uD83C\uDDE7\uD83C\uDDFF",7,7],
    ["+229","BJ","Benin","\uD83C\uDDE7\uD83C\uDDEF",8,8],
    ["+975","BT","Bhutan","\uD83C\uDDE7\uD83C\uDDF9",8,8],
    ["+591","BO","Bolivia","\uD83C\uDDE7\uD83C\uDDF4",8,8],
    ["+387","BA","Bosnia","\uD83C\uDDE7\uD83C\uDDE6",8,8],
    ["+267","BW","Botswana","\uD83C\uDDE7\uD83C\uDDFC",7,8],
    ["+55","BR","Brazil","\uD83C\uDDE7\uD83C\uDDF7",10,11],
    ["+673","BN","Brunei","\uD83C\uDDE7\uD83C\uDDF3",7,7],
    ["+359","BG","Bulgaria","\uD83C\uDDE7\uD83C\uDDEC",8,9],
    ["+226","BF","Burkina Faso","\uD83C\uDDE7\uD83C\uDDEB",8,8],
    ["+257","BI","Burundi","\uD83C\uDDE7\uD83C\uDDEE",8,8],
    ["+855","KH","Cambodia","\uD83C\uDDF0\uD83C\uDDED",8,9],
    ["+237","CM","Cameroon","\uD83C\uDDE8\uD83C\uDDF2",9,9],
    ["+1","CA","Canada","\uD83C\uDDE8\uD83C\uDDE6",10,10],
    ["+236","CF","Central African Rep.","\uD83C\uDDE8\uD83C\uDDEB",8,8],
    ["+235","TD","Chad","\uD83C\uDDF9\uD83C\uDDE9",8,8],
    ["+56","CL","Chile","\uD83C\uDDE8\uD83C\uDDF1",9,9],
    ["+86","CN","China","\uD83C\uDDE8\uD83C\uDDF3",11,11],
    ["+57","CO","Colombia","\uD83C\uDDE8\uD83C\uDDF4",10,10],
    ["+243","CD","Congo (DRC)","\uD83C\uDDE8\uD83C\uDDE9",9,9],
    ["+242","CG","Congo (Rep.)","\uD83C\uDDE8\uD83C\uDDEC",9,9],
    ["+506","CR","Costa Rica","\uD83C\uDDE8\uD83C\uDDF7",8,8],
    ["+225","CI","C\u00f4te d'Ivoire","\uD83C\uDDE8\uD83C\uDDEE",10,10],
    ["+385","HR","Croatia","\uD83C\uDDED\uD83C\uDDF7",8,9],
    ["+53","CU","Cuba","\uD83C\uDDE8\uD83C\uDDFA",8,8],
    ["+357","CY","Cyprus","\uD83C\uDDE8\uD83C\uDDFE",8,8],
    ["+420","CZ","Czech Republic","\uD83C\uDDE8\uD83C\uDDFF",9,9],
    ["+45","DK","Denmark","\uD83C\uDDE9\uD83C\uDDF0",8,8],
    ["+253","DJ","Djibouti","\uD83C\uDDE9\uD83C\uDDEF",8,8],
    ["+593","EC","Ecuador","\uD83C\uDDEA\uD83C\uDDE8",9,9],
    ["+20","EG","Egypt","\uD83C\uDDEA\uD83C\uDDEC",10,10],
    ["+503","SV","El Salvador","\uD83C\uDDF8\uD83C\uDDFB",8,8],
    ["+240","GQ","Equatorial Guinea","\uD83C\uDDEC\uD83C\uDDF6",9,9],
    ["+291","ER","Eritrea","\uD83C\uDDEA\uD83C\uDDF7",7,7],
    ["+372","EE","Estonia","\uD83C\uDDEA\uD83C\uDDEA",7,8],
    ["+251","ET","Ethiopia","\uD83C\uDDEA\uD83C\uDDF9",9,9],
    ["+679","FJ","Fiji","\uD83C\uDDEB\uD83C\uDDEF",7,7],
    ["+358","FI","Finland","\uD83C\uDDEB\uD83C\uDDEE",6,11],
    ["+33","FR","France","\uD83C\uDDEB\uD83C\uDDF7",9,9],
    ["+241","GA","Gabon","\uD83C\uDDEC\uD83C\uDDE6",7,8],
    ["+220","GM","Gambia","\uD83C\uDDEC\uD83C\uDDF2",7,7],
    ["+995","GE","Georgia","\uD83C\uDDEC\uD83C\uDDEA",9,9],
    ["+49","DE","Germany","\uD83C\uDDE9\uD83C\uDDEA",10,11],
    ["+233","GH","Ghana","\uD83C\uDDEC\uD83C\uDDED",9,9],
    ["+30","GR","Greece","\uD83C\uDDEC\uD83C\uDDF7",10,10],
    ["+502","GT","Guatemala","\uD83C\uDDEC\uD83C\uDDF9",8,8],
    ["+224","GN","Guinea","\uD83C\uDDEC\uD83C\uDDF3",9,9],
    ["+592","GY","Guyana","\uD83C\uDDEC\uD83C\uDDFE",7,7],
    ["+509","HT","Haiti","\uD83C\uDDED\uD83C\uDDF9",8,8],
    ["+504","HN","Honduras","\uD83C\uDDED\uD83C\uDDF3",8,8],
    ["+852","HK","Hong Kong","\uD83C\uDDED\uD83C\uDDF0",8,8],
    ["+36","HU","Hungary","\uD83C\uDDED\uD83C\uDDFA",9,9],
    ["+354","IS","Iceland","\uD83C\uDDEE\uD83C\uDDF8",7,7],
    ["+91","IN","India","\uD83C\uDDEE\uD83C\uDDF3",10,10],
    ["+62","ID","Indonesia","\uD83C\uDDEE\uD83C\uDDE9",9,12],
    ["+98","IR","Iran","\uD83C\uDDEE\uD83C\uDDF7",10,10],
    ["+964","IQ","Iraq","\uD83C\uDDEE\uD83C\uDDF6",10,10],
    ["+353","IE","Ireland","\uD83C\uDDEE\uD83C\uDDEA",9,9],
    ["+972","IL","Israel","\uD83C\uDDEE\uD83C\uDDF1",9,9],
    ["+39","IT","Italy","\uD83C\uDDEE\uD83C\uDDF9",9,10],
    ["+1876","JM","Jamaica","\uD83C\uDDEF\uD83C\uDDF2",7,7],
    ["+81","JP","Japan","\uD83C\uDDEF\uD83C\uDDF5",10,10],
    ["+962","JO","Jordan","\uD83C\uDDEF\uD83C\uDDF4",9,9],
    ["+7","KZ","Kazakhstan","\uD83C\uDDF0\uD83C\uDDFF",10,10],
    ["+254","KE","Kenya","\uD83C\uDDF0\uD83C\uDDEA",9,10],
    ["+965","KW","Kuwait","\uD83C\uDDF0\uD83C\uDDFC",8,8],
    ["+996","KG","Kyrgyzstan","\uD83C\uDDF0\uD83C\uDDEC",9,9],
    ["+856","LA","Laos","\uD83C\uDDF1\uD83C\uDDE6",8,10],
    ["+371","LV","Latvia","\uD83C\uDDF1\uD83C\uDDFB",8,8],
    ["+961","LB","Lebanon","\uD83C\uDDF1\uD83C\uDDE7",7,8],
    ["+231","LR","Liberia","\uD83C\uDDF1\uD83C\uDDF7",7,8],
    ["+218","LY","Libya","\uD83C\uDDF1\uD83C\uDDFE",9,9],
    ["+423","LI","Liechtenstein","\uD83C\uDDF1\uD83C\uDDEE",7,9],
    ["+370","LT","Lithuania","\uD83C\uDDF1\uD83C\uDDF9",8,8],
    ["+352","LU","Luxembourg","\uD83C\uDDF1\uD83C\uDDFA",8,9],
    ["+853","MO","Macau","\uD83C\uDDF2\uD83C\uDDF4",8,8],
    ["+261","MG","Madagascar","\uD83C\uDDF2\uD83C\uDDEC",9,10],
    ["+265","MW","Malawi","\uD83C\uDDF2\uD83C\uDDFC",7,9],
    ["+60","MY","Malaysia","\uD83C\uDDF2\uD83C\uDDFE",9,10],
    ["+960","MV","Maldives","\uD83C\uDDF2\uD83C\uDDFB",7,7],
    ["+223","ML","Mali","\uD83C\uDDF2\uD83C\uDDF1",8,8],
    ["+356","MT","Malta","\uD83C\uDDF2\uD83C\uDDF9",8,8],
    ["+222","MR","Mauritania","\uD83C\uDDF2\uD83C\uDDF7",8,8],
    ["+230","MU","Mauritius","\uD83C\uDDF2\uD83C\uDDFA",8,8],
    ["+52","MX","Mexico","\uD83C\uDDF2\uD83C\uDDFD",10,10],
    ["+373","MD","Moldova","\uD83C\uDDF2\uD83C\uDDE9",8,8],
    ["+377","MC","Monaco","\uD83C\uDDF2\uD83C\uDDE8",8,9],
    ["+976","MN","Mongolia","\uD83C\uDDF2\uD83C\uDDF3",8,8],
    ["+382","ME","Montenegro","\uD83C\uDDF2\uD83C\uDDEA",8,8],
    ["+212","MA","Morocco","\uD83C\uDDF2\uD83C\uDDE6",9,9],
    ["+258","MZ","Mozambique","\uD83C\uDDF2\uD83C\uDDFF",9,9],
    ["+95","MM","Myanmar","\uD83C\uDDF2\uD83C\uDDF2",7,10],
    ["+264","NA","Namibia","\uD83C\uDDF3\uD83C\uDDE6",7,9],
    ["+977","NP","Nepal","\uD83C\uDDF3\uD83C\uDDF5",10,10],
    ["+31","NL","Netherlands","\uD83C\uDDF3\uD83C\uDDF1",9,9],
    ["+64","NZ","New Zealand","\uD83C\uDDF3\uD83C\uDDFF",8,10],
    ["+505","NI","Nicaragua","\uD83C\uDDF3\uD83C\uDDEE",8,8],
    ["+227","NE","Niger","\uD83C\uDDF3\uD83C\uDDEA",8,8],
    ["+234","NG","Nigeria","\uD83C\uDDF3\uD83C\uDDEC",10,11],
    ["+389","MK","North Macedonia","\uD83C\uDDF2\uD83C\uDDF0",8,8],
    ["+47","NO","Norway","\uD83C\uDDF3\uD83C\uDDF4",8,8],
    ["+968","OM","Oman","\uD83C\uDDF4\uD83C\uDDF2",8,8],
    ["+92","PK","Pakistan","\uD83C\uDDF5\uD83C\uDDF0",10,10],
    ["+970","PS","Palestine","\uD83C\uDDF5\uD83C\uDDF8",9,9],
    ["+507","PA","Panama","\uD83C\uDDF5\uD83C\uDDE6",7,8],
    ["+675","PG","Papua New Guinea","\uD83C\uDDF5\uD83C\uDDEC",8,8],
    ["+595","PY","Paraguay","\uD83C\uDDF5\uD83C\uDDFE",9,9],
    ["+51","PE","Peru","\uD83C\uDDF5\uD83C\uDDEA",9,9],
    ["+63","PH","Philippines","\uD83C\uDDF5\uD83C\uDDED",10,10],
    ["+48","PL","Poland","\uD83C\uDDF5\uD83C\uDDF1",9,9],
    ["+351","PT","Portugal","\uD83C\uDDF5\uD83C\uDDF9",9,9],
    ["+974","QA","Qatar","\uD83C\uDDF6\uD83C\uDDE6",8,8],
    ["+40","RO","Romania","\uD83C\uDDF7\uD83C\uDDF4",9,9],
    ["+7","RU","Russia","\uD83C\uDDF7\uD83C\uDDFA",10,10],
    ["+250","RW","Rwanda","\uD83C\uDDF7\uD83C\uDDFC",9,9],
    ["+966","SA","Saudi Arabia","\uD83C\uDDF8\uD83C\uDDE6",9,9],
    ["+221","SN","Senegal","\uD83C\uDDF8\uD83C\uDDF3",9,9],
    ["+381","RS","Serbia","\uD83C\uDDF7\uD83C\uDDF8",8,9],
    ["+232","SL","Sierra Leone","\uD83C\uDDF8\uD83C\uDDF1",8,8],
    ["+65","SG","Singapore","\uD83C\uDDF8\uD83C\uDDEC",8,8],
    ["+421","SK","Slovakia","\uD83C\uDDF8\uD83C\uDDF0",9,9],
    ["+386","SI","Slovenia","\uD83C\uDDF8\uD83C\uDDEE",8,8],
    ["+252","SO","Somalia","\uD83C\uDDF8\uD83C\uDDF4",7,8],
    ["+27","ZA","South Africa","\uD83C\uDDFF\uD83C\uDDE6",9,9],
    ["+82","KR","South Korea","\uD83C\uDDF0\uD83C\uDDF7",9,10],
    ["+211","SS","South Sudan","\uD83C\uDDF8\uD83C\uDDF8",9,9],
    ["+34","ES","Spain","\uD83C\uDDEA\uD83C\uDDF8",9,9],
    ["+94","LK","Sri Lanka","\uD83C\uDDF1\uD83C\uDDF0",9,9],
    ["+249","SD","Sudan","\uD83C\uDDF8\uD83C\uDDE9",9,9],
    ["+46","SE","Sweden","\uD83C\uDDF8\uD83C\uDDEA",7,10],
    ["+41","CH","Switzerland","\uD83C\uDDE8\uD83C\uDDED",9,9],
    ["+963","SY","Syria","\uD83C\uDDF8\uD83C\uDDFE",9,9],
    ["+886","TW","Taiwan","\uD83C\uDDF9\uD83C\uDDFC",9,9],
    ["+992","TJ","Tajikistan","\uD83C\uDDF9\uD83C\uDDEF",9,9],
    ["+255","TZ","Tanzania","\uD83C\uDDF9\uD83C\uDDFF",9,9],
    ["+66","TH","Thailand","\uD83C\uDDF9\uD83C\uDDED",9,9],
    ["+228","TG","Togo","\uD83C\uDDF9\uD83C\uDDEC",8,8],
    ["+676","TO","Tonga","\uD83C\uDDF9\uD83C\uDDF4",5,7],
    ["+1868","TT","Trinidad & Tobago","\uD83C\uDDF9\uD83C\uDDF9",7,7],
    ["+216","TN","Tunisia","\uD83C\uDDF9\uD83C\uDDF3",8,8],
    ["+90","TR","Turkey","\uD83C\uDDF9\uD83C\uDDF7",10,10],
    ["+993","TM","Turkmenistan","\uD83C\uDDF9\uD83C\uDDF2",8,8],
    ["+256","UG","Uganda","\uD83C\uDDFA\uD83C\uDDEC",9,9],
    ["+380","UA","Ukraine","\uD83C\uDDFA\uD83C\uDDE6",9,9],
    ["+971","AE","UAE","\uD83C\uDDE6\uD83C\uDDEA",9,9],
    ["+44","GB","United Kingdom","\uD83C\uDDEC\uD83C\uDDE7",10,10],
    ["+1","US","United States","\uD83C\uDDFA\uD83C\uDDF8",10,10],
    ["+598","UY","Uruguay","\uD83C\uDDFA\uD83C\uDDFE",8,8],
    ["+998","UZ","Uzbekistan","\uD83C\uDDFA\uD83C\uDDFF",9,9],
    ["+58","VE","Venezuela","\uD83C\uDDFB\uD83C\uDDEA",10,10],
    ["+84","VN","Vietnam","\uD83C\uDDFB\uD83C\uDDF3",9,10],
    ["+967","YE","Yemen","\uD83C\uDDFE\uD83C\uDDEA",9,9],
    ["+260","ZM","Zambia","\uD83C\uDDFF\uD83C\uDDF2",9,9],
    ["+263","ZW","Zimbabwe","\uD83C\uDDFF\uD83C\uDDFC",9,9]
  ];

  // Build a lookup map: dialCode → { iso, name, flag, minDigits, maxDigits }
  // For dial codes shared by multiple countries (+1, +7), keep all entries
  var COUNTRY_MAP = {};
  for (var i = 0; i < COUNTRY_CODES.length; i++) {
    var c = COUNTRY_CODES[i];
    COUNTRY_MAP[c[1]] = { dial: c[0], iso: c[1], name: c[2], flag: c[3], min: c[4], max: c[5] };
  }

  // Find country entry by dial code (returns first match)
  function findByDial(dial) {
    for (var i = 0; i < COUNTRY_CODES.length; i++) {
      if (COUNTRY_CODES[i][0] === dial) return COUNTRY_MAP[COUNTRY_CODES[i][1]];
    }
    return null;
  }

  // Validate local digits against a specific country ISO
  function validateMobileLength(iso, localDigits) {
    var c = COUNTRY_MAP[iso];
    if (!c) return { valid: false, msg: "Unknown country" };
    var digits = localDigits.replace(/\D/g, "");
    if (digits.length < c.min || digits.length > c.max) {
      var expected = c.min === c.max ? c.min + " digits" : c.min + "-" + c.max + " digits";
      return { valid: false, msg: c.name + " numbers must be " + expected + " (you entered " + digits.length + ")" };
    }
    return { valid: true, msg: "" };
  }

  // Parse a full number like "+919876543210" into { iso, dial, local }
  function parseFullNumber(full) {
    var cleaned = full.replace(/[\s\-()]/g, "");
    if (cleaned[0] !== "+") return null;
    // Try longest dial codes first (4,3,2,1 digits after +)
    for (var len = 4; len >= 1; len--) {
      var tryDial = cleaned.substring(0, len + 1);
      for (var i = 0; i < COUNTRY_CODES.length; i++) {
        if (COUNTRY_CODES[i][0] === tryDial) {
          return { iso: COUNTRY_CODES[i][1], dial: tryDial, local: cleaned.substring(len + 1) };
        }
      }
    }
    return null;
  }

  var exported = {
    COUNTRY_CODES: COUNTRY_CODES,
    COUNTRY_MAP: COUNTRY_MAP,
    findByDial: findByDial,
    validateMobileLength: validateMobileLength,
    parseFullNumber: parseFullNumber
  };

  // UMD: works in browser (window.CountryCodes) and Node (require)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exported;
  } else {
    root.CountryCodes = exported;
  }
})(typeof window !== "undefined" ? window : this);

/**
 * 城市 → 各站点城市编码
 * BOSS: city 参数（web/geek/job?city=101020100）
 * 猎聘: dqs 参数（zhaopin/?dqs=020）
 * 编码未知 / 为空时：不带城市参数抓全国，再由严格城市过滤兜底。
 */

export const CITIES = [
  { name: '全国', boss: '100010000', liepin: '' },
  { name: '北京', boss: '101010100', liepin: '010' },
  { name: '上海', boss: '101020100', liepin: '020' },
  { name: '广州', boss: '101280100', liepin: '050020' },
  { name: '深圳', boss: '101280600', liepin: '050090' },
  { name: '杭州', boss: '101210100', liepin: '070020' },
  { name: '成都', boss: '101270100', liepin: '280020' },
  { name: '南京', boss: '101190100', liepin: '060020' },
  { name: '武汉', boss: '101200100', liepin: '170020' },
  { name: '苏州', boss: '101190400', liepin: '060080' },
  { name: '天津', boss: '101030100', liepin: '030' },
  { name: '重庆', boss: '101040100', liepin: '040' },
  { name: '西安', boss: '101110100', liepin: '' },
  { name: '长沙', boss: '101250100', liepin: '' },
  { name: '郑州', boss: '101180100', liepin: '' },
  { name: '青岛', boss: '101120200', liepin: '' },
  { name: '济南', boss: '101120100', liepin: '' },
  { name: '合肥', boss: '101220100', liepin: '' },
  { name: '厦门', boss: '101230200', liepin: '' },
  { name: '福州', boss: '101230100', liepin: '' },
  { name: '宁波', boss: '101210400', liepin: '' },
  { name: '东莞', boss: '101281600', liepin: '' },
  { name: '佛山', boss: '101280800', liepin: '' },
  { name: '无锡', boss: '101190200', liepin: '' },
  { name: '大连', boss: '101070200', liepin: '' },
  { name: '沈阳', boss: '101070100', liepin: '' },
  { name: '昆明', boss: '101290100', liepin: '' },
  { name: '哈尔滨', boss: '101050100', liepin: '' },
  { name: '长春', boss: '101060100', liepin: '' },
  { name: '石家庄', boss: '101090100', liepin: '' },
  { name: '太原', boss: '101100100', liepin: '' },
  { name: '南昌', boss: '101240100', liepin: '' },
  { name: '贵阳', boss: '101260100', liepin: '' },
  { name: '南宁', boss: '101300100', liepin: '' },
  { name: '珠海', boss: '101280700', liepin: '' },
  { name: '香港', boss: '101320100', liepin: '' }
];

export function cityCode(cityName, site) {
  const c = CITIES.find(x => x.name === cityName);
  if (!c) return '';
  return site === 'boss' ? c.boss : c.liepin;
}

export const CITY_NAMES = CITIES.map(c => c.name);

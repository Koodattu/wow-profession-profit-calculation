-- Deterministic generated data, never an export. Both regions, 30 UTC days,
-- dense / sparse cohorts, irregular prices, missed hours, nulls and precision edges.
INSERT INTO packing_baseline.commodity_snapshots
 (id,region_id,item_id,snapshot_time,min_price,avg_price,median_price,max_price,
  total_quantity,num_auctions,price_p10,price_p25,total_value)
SELECT 1000000000+row_number() OVER(ORDER BY d,h,r,i),r,2100100000+i,
  :'anchor'::date - d*interval '1 day' + h*interval '1 hour' + interval '123456 microseconds',
  p,p+31,CASE WHEN i%7=0 THEN NULL ELSE p+17 END,p+113,q,
  CASE WHEN i%13=0 THEN NULL ELSE 1+(i+h)%37 END,
  CASE WHEN i%11=0 THEN NULL ELSE p+3 END,CASE WHEN i%17=0 THEN NULL ELSE p+7 END,
  CASE WHEN i%19=0 THEN NULL ELSE (p+31)::numeric*q+1 END
FROM generate_series(0,29) d CROSS JOIN generate_series(0,23) h
  CROSS JOIN unnest(ARRAY['eu','us']) r CROSS JOIN generate_series(1,48) i
  CROSS JOIN LATERAL (SELECT 1000+abs(hashtextextended(concat(r,':',i,':',d,':',h),1005)%1000000) AS p,
    1+(i*719+h*997+d*313)%100000 AS q) price
WHERE ((i<=32 AND (i+d+h)%43<>0) OR (i>32 AND h IN (3,17) AND (i+d)%3<>0))
  AND (d>0 OR h<12);

-- Different IDs at an identical timestamp retain multiplicity and daily weights.
INSERT INTO packing_baseline.commodity_snapshots
 (id,region_id,item_id,snapshot_time,min_price,avg_price,median_price,max_price,
  total_quantity,num_auctions,price_p10,price_p25,total_value)
VALUES
 (9007199254740993,'eu',2100100091,:'anchor'::date-interval '5 days'+interval '1:02:03.123456',33,33,NULL,33,3,1,30,31,100),
 (9007199254740994,'eu',2100100091,:'anchor'::date-interval '5 days'+interval '1:02:03.123456',99,99,99,99,3,1,90,95,300),
 (9007199254740995,'eu',2100100091,:'anchor'::date-interval '5 days'+interval '4 hours',50,50,50,50,9,2,47,48,450),
 (9007199254740996,'us',2100100092,:'anchor'::date-interval '5 days'+interval '1:02:03.654321',100000000000,100000000000,NULL,100000000000,1000000,4,NULL,NULL,100000000000000001),
 (9007199254740997,'us',2100100092,:'anchor'::date-interval '5 days'+interval '4 hours',99,NULL,NULL,NULL,2,NULL,NULL,NULL,NULL),
 (9007199254740998,'eu',2100100093,:'anchor'::date-interval '6 days'+interval '2 hours',1,NULL,NULL,NULL,0,0,NULL,NULL,9999999999999999999999999999999999999999),
 (9007199254740999,'eu',2100100093,:'anchor'::date-interval '6 days'+interval '3 hours',1,NULL,NULL,NULL,0,0,NULL,NULL,NULL);

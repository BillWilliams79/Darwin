/*CREATE DATABASE IF NOT EXISTS darwin;*/
USE darwin;

/* ############################################## */
/* VERSION 0 Initial tables instatiation */

CREATE TABLE IF NOT EXISTS profiles (
	PRIMARY KEY (id),
    id					INT					NOT NULL AUTO_INCREMENT UNIQUE,
    name	 			VARCHAR(256)		NOT NULL,
    email				VARCHAR(256)		NOT NULL,
    subject				VARCHAR(64)			NOT NULL,
    userName			VARCHAR(256)		NOT NULL,
    region				VARCHAR(128)		NOT NULL,
    userPoolId			VARCHAR(128)		NOT NULL,
    create_ts	        TIMESTAMP 			NULL DEFAULT CURRENT_TIMESTAMP,
    update_ts			TIMESTAMP			NULL ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS domains (
    id 							INT				NOT NULL PRIMARY KEY AUTO_INCREMENT UNIQUE,
    domain_name 				VARCHAR(32)	NOT NULL,
    creator_fk 					INT				NULL,
    create_ts       			TIMESTAMP 		NULL DEFAULT CURRENT_TIMESTAMP,
    update_ts       			TIMESTAMP		NULL ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_fk)
        REFERENCES profiles (id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS areas (
    id							INT				NOT NULL PRIMARY KEY AUTO_INCREMENT UNIQUE,
    area_name 					VARCHAR(32)	NOT NULL,
    domain_fk					INT				NULL,
	creator_fk					INT				NULL,
    create_ts        			TIMESTAMP 		NULL DEFAULT CURRENT_TIMESTAMP,
    update_ts       			TIMESTAMP		NULL ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_fk)
        REFERENCES profiles (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
	FOREIGN KEY (domain_fk)
        REFERENCES domains (id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
    id		 					INT				NOT NULL PRIMARY KEY AUTO_INCREMENT UNIQUE,
    priority					BOOLEAN			NOT NULL,
    done						BOOLEAN			NOT NULL,
    description					VARCHAR(256)	NOT NULL,
    area_fk						INT				NULL,
	creator_fk					INT				NULL,
    create_ts        			TIMESTAMP		NULL DEFAULT CURRENT_TIMESTAMP,
    update_ts       			TIMESTAMP		NULL ON UPDATE CURRENT_TIMESTAMP,
    done_ts     				TIMESTAMP		NULL,
    FOREIGN KEY (creator_fk)
        REFERENCES profiles (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (area_fk)
        REFERENCES areas (id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
/* ######################################################################### */
/* Update #1 to support ability to close (hide) areas from task plan view    */

ALTER TABLE areas
ADD COLUMN closed TINYINT NOT NULL DEFAULT 0;

/* ######################################################################### */
/* Update #2 to support ability to close (hide) domains from task plan view  */
ALTER TABLE domains
ADD COLUMN closed TINYINT NOT NULL DEFAULT 0;

/* ######################################################################### */
/* UPDATE #3 to change profiles primary key from int to VARCHAR(64) in ORDER
             to support Cognito user name                                    */

/* DOMAINS modify dependent tables to drop FK by name first */
ALTER TABLE domains
DROP FOREIGN KEY domains_ibfk_1;

/* AREAS modify dependent tables to drop FK by name first */
ALTER TABLE areas
DROP FOREIGN KEY areas_ibfk_1;

/* TASKS modify dependent tables to drop FK by name first */
ALTER TABLE tasks
DROP FOREIGN KEY tasks_ibfk_1;

/* ########################## */

/* delete one of the duplicate records, id=1 is fine since technically was using id=2 */

DELETE FROM
	profiles
WHERE
	id = 1;

/* After all constrainst referring to the PK area dropped, drop profiles primary key */
ALTER TABLE profiles
DROP COLUMN id;

/* create new id column as primary key, with space for the Cognito user name */
ALTER TABLE profiles
ADD COLUMN id VARCHAR(64) PRIMARY KEY NOT NULL UNIQUE;

/* Set darwintestuser's correct Cognito userId as it's primary key */
UPDATE
	profiles
SET
	id = "3af9d78e-db31-4892-ab42-d1a731b724dd"
WHERE
	email = "darwintestuser@proton.me";

/* ################ */

/* for each table referencing profiles, add a new creator fk, update fk
   with the correct reference and then add the foreign key constraint */
ALTER TABLE domains
MODIFY COLUMN creator_fk VARCHAR(64) NOT NULL;

UPDATE
    domains
SET
    creator_fk = "3af9d78e-db31-4892-ab42-d1a731b724dd";

ALTER TABLE domains 
ADD CONSTRAINT domains_ibfk_1 FOREIGN KEY (creator_fk) REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;


ALTER TABLE areas
MODIFY COLUMN creator_fk VARCHAR(64) NOT NULL;

UPDATE
    areas
SET
    creator_fk = "3af9d78e-db31-4892-ab42-d1a731b724dd";

ALTER TABLE areas 
ADD CONSTRAINT areas_ibfk_1 FOREIGN KEY (creator_fk) REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;


ALTER TABLE tasks
MODIFY COLUMN creator_fk VARCHAR(64) NOT NULL;

UPDATE
    tasks
SET
    creator_fk = "3af9d78e-db31-4892-ab42-d1a731b724dd";

ALTER TABLE tasks 
ADD CONSTRAINT tasks_ibfk_1 FOREIGN KEY (creator_fk) REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;

/* ######################################################################### */
/* UPDATE #4 to support sorting areas in the UI and retaining settings       */
/*           across devices, logins and reboots                              */

ALTER TABLE areas
ADD COLUMN sort_order SMALLINT;

/* Future Update Here */

DESC areas;

ALTER TABLE areas
ADD COLUMN sort_order SMALLINT;





UPDATE tasks SET done_ts = '2022-07-17T19:00:00' WHERE id = 739;

/* ########################################################################## */
/* DEBUG AREA: starts with a DESC command that fails so scripts stop here     */
DESC PROFILES79;

use darwin;
select * from profiles;
select * from domains;

select * from areas order by id ASC;
select * from tasks;



select * from profiles;
select * from domains where creator_fk = 'sponge79-fc89-476d-ad87-b1f73345e137';
select * from areas where creator_fk = 'sponge79-fc89-476d-ad87-b1f73345e137';
select * from tasks where creator_fk = 'sponge79-fc89-476d-ad87-b1f73345e137';

DELETE FROM profiles WHERE id = 'sponge79-fc89-476d-ad87-b1f73345e137';

UPDATE domains SET closed = '1' WHERE id = 1;
use darwin;
desc areas;
show create table areas;

select * from areas where creator_fk='3af9d78e-db31-4892-ab42-d1a731b724dd' order by domain_fk ASC, -sort_order DESC;
UPDATE areas set sort_order='0', closed='0' WHERE id=1;
UPDATE areas set sort_order='1' WHERE id=2;
UPDATE areas set sort_order='2' WHERE id=3;
UPDATE areas set sort_order='3' WHERE id=4;
UPDATE areas set sort_order='4' WHERE id=5;

UPDATE areas set sort_order='0' WHERE id=42;
UPDATE areas set sort_order='1' WHERE id=43;

UPDATE areas set sort_order='1' WHERE id=53;
UPDATE areas set sort_order='6' WHERE id=54;
UPDATE areas set sort_order='0' WHERE id=55;
UPDATE areas set sort_order='3' WHERE id=56;
UPDATE areas set sort_order='4' WHERE id=57;
UPDATE areas set sort_order='5' WHERE id=58;
UPDATE areas set sort_order='2' WHERE id=60;

SELECT
	area_name, COUNT(*)
FROM
	tasks
INNER JOIN areas ON tasks.area_fk = areas.id
WHERE
	areas.domain_fk = '2' AND tasks.creator_fk='3af9d78e-db31-4892-ab42-d1a731b724dd'
GROUP BY
	area_name;

SELECT
	area_fk, COUNT(*)
FROM
	tasks
WHERE
	creator_fk='3af9d78e-db31-4892-ab42-d1a731b724dd'
GROUP BY
	area_fk;

SELECT
    CONCAT('[', JSON_OBJECT('area_fk', area_fk, 'count', count(*) ) ,']')
FROM
	tasks
WHERE
	creator_fk='3af9d78e-db31-4892-ab42-d1a731b724dd'
GROUP BY
	area_fk;

SELECT CONCAT('[', GROUP_CONCAT( JSON_OBJECT('id', id, 'priority', priority, 'done', done, 'description', description, 'area_fk', area_fk) SEPARATOR ', ') ,']') 
FROM
	tasks 
WHERE area_fk='3' AND creator_fk='3af9d78e-db31-4892-ab42-d1a731b724dd' AND done='0';

    
    

INSERT INTO areas (creator_fk, area_name, domain_fk, closed)
VALUES ("3af9d78e-db31-4892-ab42-d1a731b724dd", 'Small Bugs', 19, 0);

INSERT INTO tasks (creator_fk, area_fk, description, priority, done)
VALUES ("3af9d78e-db31-4892-ab42-d1a731b724dd", 60, 'cannot add new task to area with no existing tasks', 1, 0);

select
	*
from
	domains
where
	closed = 1;

UPDATE
	domains
SET
	closed = 0
WHERE
	closed = 1;

select * from tasks where description="abc1";

/* Display a three table star join to confirm tables and constraints function */
SELECT
	tasks.id,
    priority as 'Priority',
    done as 'Done',
    description as 'Description',
    areas.area_name AS 'Area Name',
    areas.closed AS 'Hide',
    profiles.name AS 'User Name',
    tasks.create_ts AS 'Created',
    tasks.update_ts AS 'Updated',
    tasks.done_ts AS 'Was Done'
FROM
    tasks
        INNER JOIN profiles
			ON tasks.creator_fk = profiles.id
		INNER JOIN areas
			ON tasks.area_fk = areas.id
ORDER BY tasks.id asc;
